import { NextResponse } from "next/server";
import { withRole } from "@/server/rbac";
import { periksaBaris } from "@/server/closure-store";
import type { BarisSilangan } from "@/server/closure-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ closureId: string }> };

/**
 * POST — memeriksa batch silangan TANPA menulis apa pun.
 *
 * Memakai fungsi pemeriksa yang SAMA dengan commit. Pratinjau yang punya
 * jalur validasinya sendiri akan menjanjikan sesuatu yang ditolak commit, dan
 * sesudah itu tidak ada yang mempercayai pratinjaunya lagi.
 *
 * Dijaga peran yang sama dengan commit: pratinjau membocorkan susunan core
 * dan status okupansinya, jadi ia bukan operasi baca biasa.
 */
export const POST = withRole(["admin", "noc"], async (request, _user, ctx: Ctx) => {
  const { closureId } = await ctx.params;
  let body: { rows?: BarisSilangan[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body harus JSON yang valid." }, { status: 400 });
  }

  const { closureAda, verdicts } = await periksaBaris(closureId, body.rows ?? []);
  if (!closureAda) {
    return NextResponse.json({ error: "Closure tidak ditemukan." }, { status: 404 });
  }
  const gagal = verdicts.filter((v) => !v.ok).length;
  return NextResponse.json(
    { verdicts, ringkas: { total: verdicts.length, gagal, lolos: verdicts.length - gagal } },
    { headers: { "Cache-Control": "no-store" } },
  );
});
