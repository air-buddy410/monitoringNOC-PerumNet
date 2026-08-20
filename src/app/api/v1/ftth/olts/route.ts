import { NextResponse } from "next/server";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { networkSites, odps, oltDevices } from "@/db/schema";
import { bacaKredensial } from "@/server/olt-cli";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

/** Peran yang boleh membuka konsol — sama persis dengan POST /devices/console. */
const PERAN_KONSOL = new Set(["admin", "noc"]);

/**
 * GET /api/v1/ftth/olts
 *
 * Daftar OLT untuk layar konsol (T-15). Layar itu tidak boleh meminta
 * host/port dari pengguna — `POST /api/v1/devices/console` sengaja hanya
 * menerima `oltId` — jadi ia butuh daftar ini untuk mengisi pilihannya.
 *
 * Selain nama, tiap baris membawa `konsolSiap`: apakah perangkat ini
 * benar-benar bisa dibuka SEKARANG. Tanpa itu layar hanya bisa menawarkan
 * semua OLT lalu membiarkan pengguna menemukan sendiri mana yang gagal —
 * lewat galat 409 yang datang setelah perintah diketik, bukan sebelumnya.
 *
 * Kesiapan dihitung dengan `bacaKredensial()` yang sama dengan yang dipakai
 * saat menyambung, bukan dengan pemeriksaan tiruan. Dua pemeriksaan berbeda
 * tentang hal yang sama akan berbeda jawabannya cepat atau lambat.
 *
 * `credentialRef` sendiri TIDAK pernah dikirim keluar. Ia hanya nama env var,
 * bukan kata sandi — tapi ia juga tidak dibutuhkan layar mana pun, dan yang
 * tidak dibutuhkan tidak perlu dikirim. Namanya hanya muncul di dalam
 * `alasan`, dan hanya bagi peran yang memang boleh membuka konsol: peran lain
 * tidak akan memperbaikinya, jadi tidak perlu tahu kunci mana yang kurang.
 */
export const GET = withRole([], async (_request, user) => {
  const rows = await db
    .select({
      id: oltDevices.id,
      name: oltDevices.name,
      managementIp: oltDevices.managementIp,
      vendor: oltDevices.vendor,
      model: oltDevices.model,
      siteId: oltDevices.siteId,
      siteName: networkSites.name,
      telnetPort: oltDevices.telnetPort,
      assetId: oltDevices.assetId,
      credentialRef: oltDevices.credentialRef,
      odpCount: sql<number>`(select count(*) from ${odps} where ${odps.oltId} = ${oltDevices.id})::int`,
    })
    .from(oltDevices)
    .leftJoin(networkSites, eq(networkSites.id, oltDevices.siteId))
    .orderBy(asc(oltDevices.name));

  const bolehTahuDetail = PERAN_KONSOL.has(user.role);

  const olts = rows.map(({ credentialRef, ...row }) => {
    let konsolSiap = false;
    let alasan: string | null = null;

    if (!row.telnetPort) {
      alasan = `${row.name} belum punya telnet_port — konsol tidak bisa dibuka.`;
    } else {
      try {
        // Nilainya dibuang; yang dipakai hanya "apakah ia terbaca".
        bacaKredensial(credentialRef);
        konsolSiap = true;
      } catch (e) {
        alasan = e instanceof Error ? e.message : String(e);
      }
    }

    return {
      ...row,
      konsolSiap,
      alasan: alasan
        ? bolehTahuDetail
          ? alasan
          : "Konsol perangkat ini belum siap dipakai."
        : null,
    };
  });

  return NextResponse.json(
    { olts, konsolTersedia: bolehTahuDetail },
    { headers: { "Cache-Control": "no-store" } },
  );
});
