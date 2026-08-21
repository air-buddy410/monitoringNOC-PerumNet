import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  NAMA_COOKIE,
  UMUR_COOKIE_DETIK,
  bacaNilaiCookie,
  berlakuSampai,
  buatNilaiCookie,
  catatPemakaian,
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
 *
 * Cookienya juga DIPERBARUI tiap permintaan yang sah. Tanpa itu layar mati
 * sendiri setelah 12 jam: tokennya sudah dihapus dari address bar demi
 * keamanan, jadi tidak ada lagi yang bisa ditukar, dan wallboard tidak punya
 * keyboard untuk memasukkannya kembali. Yang memperpanjang tetap bukan
 * cookienya melainkan barisnya — pembaruan ini tidak pernah melampaui masa
 * berlaku token, dan pencabutan tetap berlaku pada polling berikutnya.
 */
export async function GET() {
  const jar = await cookies();
  const tokenId = bacaNilaiCookie(jar.get(NAMA_COOKIE)?.value);
  const kedaluwarsaToken = tokenId ? await berlakuSampai(tokenId) : null;
  if (!tokenId || !kedaluwarsaToken) {
    return NextResponse.json(
      { error: "Layar TV belum tersambung atau tautannya sudah dicabut." },
      { status: 401 },
    );
  }
  // `.catch` bukan basa-basi: janji yang ditolak tanpa penangkap adalah
  // unhandled rejection, dan Node 22 mengakhiri prosesnya. Pencatat pemakaian
  // yang sifatnya sekadar enak-punya tidak boleh sanggup menjatuhkan portal
  // hanya karena database sedang tersendat.
  void catatPemakaian(tokenId).catch((e) => {
    console.error("[tv] gagal mencatat pemakaian token:", e);
  });

  const res = NextResponse.json(await bacaTvSnapshot(), {
    headers: { "Cache-Control": "no-store" },
  });

  const sisaDetik = Math.floor((kedaluwarsaToken.getTime() - Date.now()) / 1000);
  const umur = Math.max(60, Math.min(UMUR_COOKIE_DETIK, sisaDetik));
  res.cookies.set({
    name: NAMA_COOKIE,
    value: buatNilaiCookie(tokenId, Math.floor(Date.now() / 1000) + umur),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: umur,
  });
  return res;
}
