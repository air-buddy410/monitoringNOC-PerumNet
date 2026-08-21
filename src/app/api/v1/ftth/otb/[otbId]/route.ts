import { NextResponse } from "next/server";
import { withRole } from "@/server/rbac";
import { detailOtb } from "@/server/otb-store";
import { ubahOtb } from "@/server/fiber-store";
import type { UbahOtbInput } from "@/server/fiber-store";

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

/**
 * PATCH — mengubah atribut OTB. Kapasitas TIDAK diubah dari sini; ia punya
 * jalurnya sendiri di `PATCH …/trays/:n`, karena penurunan kapasitas adalah
 * satu-satunya operasi yang menghapus baris dan aturannya jauh lebih ketat.
 */
export const PATCH = withRole(["admin", "noc"], async (request, user, ctx: Ctx) => {
  const { otbId } = await ctx.params;
  let body: UbahOtbInput & { trayCount?: unknown; portsPerTray?: unknown; portCount?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body harus JSON yang valid." }, { status: 400 });
  }
  if (body.trayCount !== undefined || body.portsPerTray !== undefined || body.portCount !== undefined) {
    return NextResponse.json(
      { error: "Kapasitas diubah lewat PATCH /api/v1/ftth/otb/:otbId/trays/:trayNumber." },
      { status: 400 },
    );
  }
  if (body.status && body.status !== "aktif" && body.status !== "nonaktif") {
    return NextResponse.json({ error: "status harus aktif atau nonaktif." }, { status: 400 });
  }

  const hasil = await ubahOtb(otbId, body, user.id);
  if (!hasil.ok) {
    return NextResponse.json({ error: hasil.error }, { status: hasil.status });
  }
  return NextResponse.json(hasil.data);
});
