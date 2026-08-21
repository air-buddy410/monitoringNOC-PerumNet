import { NextResponse } from "next/server";
import { withRole } from "@/server/rbac";
import { riwayatTerminasiCore } from "@/server/fiber-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ coreId: string }> };

/**
 * GET /api/v1/ftth/cores/:coreId/terminations — riwayat terminasi satu core.
 *
 * Mengembalikan SELURUH terminasi, termasuk yang sudah dilepas. Yang sudah
 * dilepas justru yang dicari saat gangguan — "jalur ini dulu menempel di
 * mana" — dan `GET /cables/:id` hanya mengirim ujung yang aktif.
 *
 * Ditambahkan setelah permintaan Luna di `PERMINTAAN-FRONTEND-KE-BACKEND.md`:
 * fungsinya sudah ada sejak Fase 12 tapi tidak pernah punya route, jadi panel
 * riwayat di layar kabel tidak punya sumber data.
 */
export const GET = withRole([], async (_request, _user, ctx: Ctx) => {
  const { coreId } = await ctx.params;
  const terminations = await riwayatTerminasiCore(coreId);
  return NextResponse.json(
    { terminations },
    { headers: { "Cache-Control": "no-store" } },
  );
});
