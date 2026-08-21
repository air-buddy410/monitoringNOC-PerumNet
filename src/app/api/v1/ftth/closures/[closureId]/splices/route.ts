import { NextResponse } from "next/server";
import { withRole } from "@/server/rbac";
import { pasangSilangan } from "@/server/closure-store";
import type { BarisSilangan } from "@/server/closure-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ closureId: string }> };

/**
 * POST — memasang satu batch silangan core. SEMUA ATAU TIDAK SAMA SEKALI.
 *
 * Satu baris bentrok membatalkan seluruh batch dan tidak ada yang disimpan.
 * Jawaban `409` memuat baris pertama yang gagal beserta alasannya.
 */
export const POST = withRole(["admin", "noc"], async (request, user, ctx: Ctx) => {
  const { closureId } = await ctx.params;
  let body: { rows?: BarisSilangan[]; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body harus JSON yang valid." }, { status: 400 });
  }

  const hasil = await pasangSilangan(closureId, body.rows ?? [], body.reason ?? "", user.id);
  if (!hasil.ok) return NextResponse.json({ error: hasil.error }, { status: hasil.status });
  return NextResponse.json(hasil.data, { status: 201 });
});
