import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  NAMA_COOKIE,
  bacaNilaiCookie,
  catatPemakaian,
  tokenMasihBerlaku,
} from "@/server/tv-token";
import { bacaTvSnapshot } from "@/server/tv-snapshot";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/tv/snapshot
 *
 * SATU-SATUNYA endpoint yang menerima cookie TV. Verifikatornya hidup di
 * berkas ini dan tidak diekspor — supaya tidak ada yang "sekalian" menerima
 * cookie TV di endpoint yang mengubah sesuatu, enam bulan dari sekarang.
 *
 * Barisnya diperiksa pada SETIAP permintaan, bukan hanya saat cookie dibuat.
 * Itulah yang membuat pencabutan berlaku seketika — mencabut token mematikan
 * layar pada polling berikutnya, bukan 12 jam kemudian.
 */
export async function GET() {
  const jar = await cookies();
  const tokenId = bacaNilaiCookie(jar.get(NAMA_COOKIE)?.value);
  if (!tokenId || !(await tokenMasihBerlaku(tokenId))) {
    return NextResponse.json(
      { error: "Layar TV belum tersambung atau tautannya sudah dicabut." },
      { status: 401 },
    );
  }
  void catatPemakaian(tokenId);
  return NextResponse.json(await bacaTvSnapshot(), {
    headers: { "Cache-Control": "no-store" },
  });
}
