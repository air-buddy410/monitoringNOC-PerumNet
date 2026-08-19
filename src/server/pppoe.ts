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

async function ambilDariRouter(cfg: PppoeConfig): Promise<PppoeActive[]> {
  const res = await fetch(`${cfg.baseUrl}/rest/ppp/active`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.user}:${cfg.password}`).toString("base64")}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`RouterOS menjawab HTTP ${res.status}`);
  const data: unknown = await res.json();
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
