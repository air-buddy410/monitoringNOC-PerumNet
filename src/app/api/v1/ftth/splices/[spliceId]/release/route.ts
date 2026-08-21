import { NextResponse } from "next/server";
import { withRole } from "@/server/rbac";
import { lepasSilangan } from "@/server/closure-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ spliceId: string }> };

/** POST …/splices/:id/release — melepas silangan. Barisnya TIDAK dihapus. */
export const POST = withRole(["admin", "noc"], async (request, user, ctx: Ctx) => {
  const { spliceId } = await ctx.params;
  let body: { reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body harus JSON yang valid." }, { status: 400 });
  }

  const hasil = await lepasSilangan(spliceId, body.reason ?? "", user.id);
  if (!hasil.ok) return NextResponse.json({ error: hasil.error }, { status: hasil.status });
  return NextResponse.json(hasil.data);
});
