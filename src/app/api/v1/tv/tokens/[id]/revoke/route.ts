import { NextResponse } from "next/server";
import { withRole } from "@/server/rbac";
import { cabutToken } from "@/server/tv-token";

export const dynamic = "force-dynamic";

/** Pencabutan berlaku SEKETIKA — snapshot memeriksa barisnya tiap permintaan. */
export const POST = withRole(
  ["admin"],
  async (_request, user, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const ok = await cabutToken(id, user.id);
    if (!ok) {
      return NextResponse.json({ error: "Token tidak ditemukan." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  },
);
