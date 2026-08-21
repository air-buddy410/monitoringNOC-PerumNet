import { NextResponse } from "next/server";
import { withRole } from "@/server/rbac";
import { detailKabel } from "@/server/fiber-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ cableId: string }> };

/**
 * GET /api/v1/ftth/cables/:cableId — kabel beserta seluruh core-nya.
 *
 * `ujungTerpakai` per core diturunkan dari terminasi AKTIF saja; terminasi
 * yang sudah dilepas tetap ada di database tapi tidak ikut menghitung.
 */
export const GET = withRole([], async (_request, _user, ctx: Ctx) => {
  const { cableId } = await ctx.params;
  const detail = await detailKabel(cableId);
  if (!detail) {
    return NextResponse.json({ error: "Kabel tidak ditemukan." }, { status: 404 });
  }
  return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
});
