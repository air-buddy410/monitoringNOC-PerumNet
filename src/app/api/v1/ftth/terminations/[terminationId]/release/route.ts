import { NextResponse } from "next/server";
import { withRole } from "@/server/rbac";
import { lepasTerminasi } from "@/server/fiber-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ terminationId: string }> };

/**
 * POST …/terminations/:id/release — melepas terminasi.
 *
 * Sengaja POST ke sub-jalur, bukan DELETE: barisnya TIDAK dihapus. Ia diberi
 * `deactivated_at` dan alasannya, lalu keluar sendiri dari perhitungan
 * okupansi karena index-nya parsial. Memakai DELETE akan menyiratkan yang
 * sebaliknya kepada siapa pun yang membaca daftar endpoint.
 */
export const POST = withRole(["admin", "noc"], async (request, user, ctx: Ctx) => {
  const { terminationId } = await ctx.params;
  let body: { reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body harus JSON yang valid." }, { status: 400 });
  }

  const hasil = await lepasTerminasi(terminationId, body.reason ?? "", user.id);
  if (!hasil.ok) {
    return NextResponse.json({ error: hasil.error }, { status: hasil.status });
  }
  return NextResponse.json(hasil.data);
});
