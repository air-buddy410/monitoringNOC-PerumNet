import { NextResponse } from "next/server";
import { withRole } from "@/server/rbac";
import { riwayatTerminasiKabel } from "@/server/fiber-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ cableId: string }> };

/**
 * GET /api/v1/ftth/cables/:cableId/terminations — riwayat SELURUH core kabel.
 *
 * Satu permintaan, satu kueri. Endpoint per-core (`/cores/:id/terminations`)
 * tetap ada untuk panel satu core, tapi memanggilnya sekali per core membuat
 * kabel 288 core menjadi 288 permintaan HTTP — masing-masing dengan join lima
 * tabel.
 *
 * Baris membawa `coreId` dan `coreNumber`, dan sudah diurut per nomor core
 * lalu waktu, supaya layar tidak perlu mengurut ulang hasil gabungan.
 */
export const GET = withRole([], async (_request, _user, ctx: Ctx) => {
  const { cableId } = await ctx.params;
  const terminations = await riwayatTerminasiKabel(cableId);
  return NextResponse.json(
    { terminations },
    { headers: { "Cache-Control": "no-store" } },
  );
});
