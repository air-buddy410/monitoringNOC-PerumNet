import { NextResponse } from "next/server";
import { withRole } from "@/server/rbac";
import { detailClosure } from "@/server/closure-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ closureId: string }> };

/**
 * GET /api/v1/ftth/closures/:closureId — matriks silangan core.
 *
 * `?riwayat=1` ikut mengembalikan silangan yang sudah dilepas. Itu yang
 * dicari orang saat gangguan, bukan keadaan sekarang.
 */
export const GET = withRole([], async (request, _user, ctx: Ctx) => {
  const { closureId } = await ctx.params;
  const riwayat = new URL(request.url).searchParams.get("riwayat") === "1";
  const detail = await detailClosure(closureId, !riwayat);
  if (!detail) {
    return NextResponse.json({ error: "Closure tidak ditemukan." }, { status: 404 });
  }
  return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
});
