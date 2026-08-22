// Pagar bersama untuk setiap jalur yang membuka telnet ke OLT produksi.
//
// KENAPA DIPISAH: sebelum 22 Agustus 2026 pembatas laju dan pencatat audit
// hidup sebagai fungsi privat di dalam `api/v1/devices/console/route.ts`.
// Begitu ada endpoint KEDUA yang juga membuka telnet (daftar ONU),
// menyalinnya berarti dua anggaran terpisah — satu pengguna bisa membuka 20
// sesi lewat konsol DAN 20 lagi lewat daftar ONU dalam menit yang sama,
// yaitu dua kali lipat dari batas yang sengaja dipasang.
//
// Anggarannya satu, dipakai bersama, dan itu intinya.

import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const percobaan = new Map<string, { n: number; mulai: number }>();

/**
 * Benar bila pengguna ini sudah melewati jatah sesi telnet semenit terakhir.
 *
 * Dihitung per pengguna, bukan per endpoint — lihat catatan di kepala berkas.
 */
export function terlaluSering(userId: string): boolean {
  const now = Date.now();
  const e = percobaan.get(userId);
  if (!e || now - e.mulai >= WINDOW_MS) {
    percobaan.set(userId, { n: 1, mulai: now });
    return false;
  }
  e.n += 1;
  return e.n > MAX_PER_WINDOW;
}

/** Hanya untuk tes — mengosongkan hitungan antar-kasus. */
export function resetPembatas(): void {
  percobaan.clear();
}

/**
 * Catat satu percobaan konsol.
 *
 * Yang DITOLAK ikut dicatat, bukan hanya yang berhasil: konsol tanpa jejak
 * adalah konsol yang tidak bisa dipertanggungjawabkan, dan percobaan yang
 * ditolak justru yang paling perlu terlihat.
 */
export async function catatKonsol(
  userId: string,
  userName: string,
  oltId: string,
  perintah: string,
  hasil: "dijalankan" | "ditolak" | "gagal",
  detail?: string,
): Promise<void> {
  await db.insert(auditLogs).values({
    id: randomUUID(),
    actorUserId: userId,
    actorLabel: userName,
    action: `console.${hasil}`,
    entityType: "olt_device",
    entityId: oltId,
    detail: { perintah, ...(detail ? { detail } : {}) },
    createdAt: new Date(),
  });
}
