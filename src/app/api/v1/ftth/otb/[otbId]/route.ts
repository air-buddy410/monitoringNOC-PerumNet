import { NextResponse } from "next/server";
import { withRole } from "@/server/rbac";
import { detailOtb } from "@/server/otb-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ otbId: string }> };

/**
 * GET /api/v1/ftth/otb/:otbId — kepala OTB + seluruh tray berlencana status.
 *
 * Kepala OTB ikut di sini supaya layar tidak memanggil dua kali: judul
 * "Tray 1 — LC/APC 24 Port" butuh konektor, polish, dan jumlah port sekaligus.
 *
 * Sengaja TIDAK ada DELETE di fase ini. FK-nya cascade, jadi satu DELETE
 * memusnahkan seluruh tray dan port — dan membuat setiap `entity_id` di
 * `audit_logs` menunjuk baris yang tidak ada lagi. Padahal jejak audit itulah
 * yang dipakai `aturKapasitasTray` untuk menolak penghapusan port berriwayat.
 * Cara menonaktifkan OTB adalah mengubah `status` jadi `nonaktif`.
 */
export const GET = withRole([], async (_request, _user, ctx: Ctx) => {
  const { otbId } = await ctx.params;
  const detail = await detailOtb(otbId);
  if (!detail) {
    return NextResponse.json({ error: "OTB tidak ditemukan." }, { status: 404 });
  }
  return NextResponse.json(detail, {
    headers: { "Cache-Control": "no-store" },
  });
});
