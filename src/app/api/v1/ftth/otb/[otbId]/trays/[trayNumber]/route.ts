import { NextResponse } from "next/server";
import { withRole } from "@/server/rbac";
import { aturKapasitasTray } from "@/server/otb-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ otbId: string; trayNumber: string }> };

/**
 * PATCH /api/v1/ftth/otb/:otbId/trays/:trayNumber — mengubah kapasitas tray.
 *
 * Jalur terpisah dari pengubahan port karena ini satu-satunya operasi yang
 * MENGHAPUS baris. Kalau kelak perlu diperketat jadi `["admin"]` saja, tidak
 * ada handler yang harus dibelah lebih dulu.
 *
 * Body menyebut bentuk AKHIR (`portCount`), bukan selisih: dua permintaan
 * bersamaan yang masing-masing menyebut "+4" akan saling menimpa diam-diam,
 * sedangkan dua permintaan yang menyebut "jadi 28" tidak.
 */
export const PATCH = withRole(["admin", "noc"], async (request, user, ctx: Ctx) => {
  const { otbId, trayNumber } = await ctx.params;
  const nomor = Number(trayNumber);
  if (!Number.isInteger(nomor) || nomor <= 0) {
    return NextResponse.json(
      { error: "Nomor tray harus bilangan bulat positif." },
      { status: 400 },
    );
  }

  let body: { portCount?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body harus JSON yang valid." },
      { status: 400 },
    );
  }

  const hasil = await aturKapasitasTray(
    otbId,
    nomor,
    body.portCount as number,
    user.id,
  );
  if (!hasil.ok) {
    return NextResponse.json({ error: hasil.error }, { status: hasil.status });
  }
  return NextResponse.json(hasil.data);
});
