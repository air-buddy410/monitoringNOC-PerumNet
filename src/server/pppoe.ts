// Penarikan sesi PPPoE dari router distribusi (RouterOS REST).
//
// BACA-SAJA terhadap router: satu GET ke /rest/ppp/active, tidak ada
// konfigurasi yang disentuh. Sekategori dengan pembacaan LibreNMS, jadi tidak
// melewati outward-guard.
//
// Yang disimpan sengaja hanya `username` — bukan nama, alamat, atau nomor
// pelanggan. Repo ini publik, dan pemetaan username ke orang milik CRM.
//
// Tanpa konfigurasi router, tugasnya BERHENTI dengan status SKIPPED dan alasan
// yang tertulis — bukan gagal, dan bukan pula diam. Tugas yang diam saat belum
// dikonfigurasi tidak bisa dibedakan dari tugas yang rusak.

import https from "node:https";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { pppoePollRuns, pppoeSessions } from "@/db/schema";
import type { TaskDefinition } from "@/server/scheduler";

export interface PppoeActive {
  name: string;
  address?: string;
  "caller-id"?: string;
  uptime?: string;
}

export type PppoeFetcher = () => Promise<PppoeActive[]>;

export interface PppoeConfig {
  baseUrl: string;
  user: string;
  password: string;
  routerName: string;
}

export function pppoeConfig(): PppoeConfig | null {
  const baseUrl = process.env.MIKROTIK_URL?.trim();
  const user = process.env.MIKROTIK_USER?.trim();
  const password = process.env.MIKROTIK_PASSWORD?.trim();
  if (!baseUrl || !user || !password) return null;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    user,
    password,
    routerName: process.env.MIKROTIK_NAME?.trim() || new URL(baseUrl).hostname,
  };
}

/** "1w2d03:04:05" → detik. Bentuk RouterOS, bukan ISO. */
export function parseUptime(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/^(?:(\d+)w)?(?:(\d+)d)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return null;
  const [, w, d, h, mi, s] = m;
  return (
    Number(w ?? 0) * 604_800 +
    Number(d ?? 0) * 86_400 +
    Number(h ?? 0) * 3_600 +
    Number(mi) * 60 +
    Number(s)
  );
}

/**
 * RouterOS memakai sertifikat yang diterbitkannya sendiri, jadi verifikasi TLS
 * akan MENOLAK sambungan walau kredensialnya benar — dan galatnya tidak
 * menyebut sertifikat sama sekali, jadi orang akan mengira kata sandinya salah.
 *
 * Karena itu ia dilewati HANYA bila `MIKROTIK_INSECURE_TLS=true` disetel dengan
 * sengaja. Tidak dijadikan bawaan: mematikan verifikasi diam-diam berarti
 * portal ini akan menerima siapa pun yang bisa menyamar sebagai router, dan
 * kelak saat router dipasangi sertifikat yang benar tidak ada yang tahu bahwa
 * perlindungannya sudah lama dimatikan.
 *
 * Yang membuatnya bisa diterima di sini: jaringannya internal (192.168.100.0/24
 * lewat 10.10.222.1), dan yang dikirim cuma permintaan BACA.
 */
function tlsLonggar(): boolean {
  return (process.env.MIKROTIK_INSECURE_TLS ?? "").trim().toLowerCase() === "true";
}

/** Dipakai langsung, bukan lewat fetch: `fetch` Node tidak menyediakan cara
 *  melonggarkan verifikasi sertifikat per-permintaan tanpa menambah dependensi
 *  atau mematikannya untuk SELURUH proses. */
function ambilJson(url: string, headers: Record<string, string>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: "GET",
        headers,
        timeout: 15_000,
        rejectUnauthorized: !tlsLonggar(),
      },
      (res) => {
        let isi = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (isi += c));
        res.on("end", () => {
          if ((res.statusCode ?? 0) === 401) {
            return reject(new Error("RouterOS menolak kredensial (HTTP 401)."));
          }
          if ((res.statusCode ?? 0) >= 400) {
            return reject(new Error(`RouterOS menjawab HTTP ${res.statusCode}`));
          }
          try {
            resolve(JSON.parse(isi));
          } catch {
            reject(new Error("Jawaban RouterOS bukan JSON yang sah."));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("RouterOS tidak menjawab dalam 15 detik.")));
    req.on("error", (e) => {
      const pesan = /self.signed|unable to verify|DEPTH_ZERO/i.test(e.message)
        ? `Sertifikat router tidak tepercaya. Setel MIKROTIK_INSECURE_TLS=true bila ini memang router internal kita. (${e.message})`
        : e.message;
      reject(new Error(pesan));
    });
    req.end();
  });
}

async function ambilDariRouter(cfg: PppoeConfig): Promise<PppoeActive[]> {
  const data = await ambilJson(`${cfg.baseUrl}/rest/ppp/active`, {
    Authorization: `Basic ${Buffer.from(`${cfg.user}:${cfg.password}`).toString("base64")}`,
    Accept: "application/json",
  });
  if (!Array.isArray(data)) throw new Error("Jawaban RouterOS bukan larik.");
  return data as PppoeActive[];
}

export interface PppoePollResult {
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  sessionCount: number;
  detail: string;
}

export async function pollPppoe(
  opts: { fetcher?: PppoeFetcher; now?: Date } = {},
): Promise<PppoePollResult> {
  const now = opts.now ?? new Date();
  const cfg = pppoeConfig();
  const runId = randomUUID();

  if (!cfg && !opts.fetcher) {
    await db.insert(pppoePollRuns).values({
      id: runId,
      startedAt: now,
      finishedAt: now,
      status: "SKIPPED",
      error: "MIKROTIK_URL/USER/PASSWORD belum diisi",
    });
    return {
      status: "SKIPPED",
      sessionCount: 0,
      detail: "router belum dikonfigurasi (MIKROTIK_URL/USER/PASSWORD)",
    };
  }

  await db.insert(pppoePollRuns).values({ id: runId, startedAt: now, status: "RUNNING" });

  try {
    const aktif = opts.fetcher ? await opts.fetcher() : await ambilDariRouter(cfg!);

    // Gambaran "siapa online SEKARANG" — sesi yang tidak lagi dilaporkan
    // memang harus hilang. Riwayatnya ada di pppoe_poll_runs, bukan di sini.
    await db.delete(pppoeSessions);
    if (aktif.length > 0) {
      await db.insert(pppoeSessions).values(
        aktif.map((s) => ({
          id: randomUUID(),
          username: s.name,
          callerId: s["caller-id"] ?? null,
          address: s.address ?? null,
          uptimeSec: parseUptime(s.uptime),
          routerName: cfg?.routerName ?? "uji",
          seenAt: now,
          pollRunId: runId,
        })),
      );
    }

    await db
      .update(pppoePollRuns)
      .set({ finishedAt: new Date(), status: "SUCCESS", sessionCount: aktif.length })
      .where(eq(pppoePollRuns.id, runId));

    return { status: "SUCCESS", sessionCount: aktif.length, detail: `${aktif.length} sesi aktif` };
  } catch (error) {
    const pesan = error instanceof Error ? error.message : String(error);
    await db
      .update(pppoePollRuns)
      .set({ finishedAt: new Date(), status: "FAILED", error: pesan })
      .where(eq(pppoePollRuns.id, runId));
    // Kegagalan menarik BUKAN alasan menghapus gambaran terakhir: lebih baik
    // menampilkan data yang tua dan bisa diketahui umurnya daripada kosong.
    return { status: "FAILED", sessionCount: 0, detail: pesan };
  }
}

export const PPPOE_TASKS: TaskDefinition[] = [
  {
    code: "pppoe.poll",
    name: "Tarik sesi PPPoE",
    description:
      "Membaca /rest/ppp/active dari router distribusi. Hanya membaca; tidak mengubah konfigurasi router.",
    defaultIntervalSec: 60,
    enabledByDefault: true,
    run: async () => {
      const r = await pollPppoe();
      if (r.status === "FAILED") throw new Error(r.detail);
      return r.detail;
    },
  },
];
