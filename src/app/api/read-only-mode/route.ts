import { NextResponse } from "next/server";
import {
  configuredOutwardChannels,
  outwardMode,
} from "@/server/outward-guard";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

/**
 * GET /api/read-only-mode
 *
 * Memberitahu frontend apakah portal sedang menahan aksi keluar, supaya layar
 * tidak perlu menebak — dan supaya satu-satunya cara mengetahuinya bukan
 * membaca .env di server.
 *
 * Beda dengan `GET /api/auth-mode` yang sengaja publik: yang itu dibutuhkan
 * halaman login sebelum ada sesi dan hanya menyebut CARA login diperiksa. Yang
 * ini menyebut postur operasional — apakah jalur notifikasi hidup — jadi cukup
 * login dulu. Peran apa pun boleh.
 *
 * Tidak pernah memuat URL, token, atau nama host. Hanya mode dan boolean.
 */
export const GET = withRole([], async () => {
  const mode = outwardMode();
  const configured = configuredOutwardChannels();
  const armed = Object.values(configured).filter(Boolean).length;

  return NextResponse.json(
    {
      readOnly: mode === "BLOCKED",
      outwardActions: mode,
      /** Kanal yang AKAN bertindak keluar SEANDAINYA mode ALLOWED.
       *  Ini bukan status pengiriman. */
      configured,
      /** Kalimat siap tampil — tampilkan apa adanya. */
      reason:
        mode === "BLOCKED"
          ? armed > 0
            ? `Mode baca-saja: ${armed} kanal terkonfigurasi tetapi ditahan sampai cutover dari ALUS.`
            : "Mode baca-saja: portal tidak mengirim notifikasi maupun mendorong data ke sistem lain."
          : "Mode penuh: aksi keluar diizinkan.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
