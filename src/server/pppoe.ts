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
import {
  ambilJson,
  headerAuth,
  normalkanUrlRouter,
  routerConfig,
  sebabBelumSiap,
} from "@/server/routeros";
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

/**
 * Diangkat ke `src/server/routeros.ts` pada 20 Agustus 2026 supaya pengambil
 * trafik memakai klien yang SAMA. Alasannya bukan kerapian: logika
 * pelonggaran TLS tidak boleh punya dua salinan — kalau kelak salah satunya
 * dikencangkan, salinan kedua tetap longgar tanpa ada yang tahu.
 *
 * Di-export ulang di sini supaya permukaan publik modul ini tidak berubah.
 */
export { normalkanUrlRouter, sebabBelumSiap };

/** Konfigurasi router untuk penarikan PPPoE. Bentuknya sama dengan
 *  `routerConfig()`; namanya dipertahankan karena sudah dipakai di tes. */
export function pppoeConfig(): PppoeConfig | null {
  return routerConfig();
}

/**
 * Uptime RouterOS → detik.
 *
 * DUA bentuk, dan keduanya nyata:
 * - REST `/rest/ppp/active` → `14w5d22h44m53s` (bersuffix)
 * - konsol/API lama          → `1w2d03:04:05`  (jam bertitik dua)
 *
 * Semula hanya bentuk kedua yang ditangani; akibatnya 1.609 sesi tersimpan
 * dengan uptime kosong tanpa satu galat pun — data yang hilang diam-diam,
 * bukan gagal yang terlihat.
 */
export function parseUptime(raw: string | undefined): number | null {
  if (!raw) return null;
  const teks = raw.trim();
  if (!teks) return null;

  // Bentuk bersuffix: 14w5d22h44m53s (bagian mana pun boleh tidak ada).
  if (/^(\d+w)?(\d+d)?(\d+h)?(\d+m)?(\d+s)?$/.test(teks) && /\d/.test(teks)) {
    const ambil = (huruf: string) =>
      Number(new RegExp(`(\\d+)${huruf}`).exec(teks)?.[1] ?? 0);
    return (
      ambil("w") * 604_800 +
      ambil("d") * 86_400 +
      ambil("h") * 3_600 +
      ambil("m") * 60 +
      ambil("s")
    );
  }

  // Bentuk jam bertitik dua: 1w2d03:04:05
  const m = teks.match(/^(?:(\d+)w)?(?:(\d+)d)?(?:(\d+):)?(\d+):(\d+)$/);
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
  const data = await ambilJson(`${cfg.baseUrl}/rest/ppp/active`, headerAuth(cfg));
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
    const sebab = sebabBelumSiap() ?? "konfigurasi router tidak lengkap";
    await db.insert(pppoePollRuns).values({
      id: runId,
      startedAt: now,
      finishedAt: now,
      status: "SKIPPED",
      error: sebab,
    });
    return { status: "SKIPPED", sessionCount: 0, detail: `router belum siap — ${sebab}` };
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
