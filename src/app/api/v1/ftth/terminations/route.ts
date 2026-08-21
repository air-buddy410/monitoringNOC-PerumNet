import { NextResponse } from "next/server";
import { withRole } from "@/server/rbac";
import { terminasiCore } from "@/server/fiber-store";
import type { TerminasiInput } from "@/server/fiber-store";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/ftth/terminations — menerminasi satu ujung core ke satu port.
 *
 * Isi TEPAT SATU dari `otbPortId` atau `odpPortId`. Keduanya terisi atau
 * keduanya kosong ditolak di sini, dan juga ditolak CHECK di database —
 * terminasi yang tidak menempel di mana pun tidak akan pernah ditemukan trace
 * dan tidak akan ada yang tahu sampai jalurnya ditelusuri.
 */
export const POST = withRole(["admin", "noc"], async (request, user) => {
  let body: TerminasiInput;
  try {
    body = (await request.json()) as TerminasiInput;
  } catch {
    return NextResponse.json({ error: "Body harus JSON yang valid." }, { status: 400 });
  }
  if (!body.coreId) {
    return NextResponse.json({ error: "coreId wajib diisi." }, { status: 400 });
  }

  const hasil = await terminasiCore(body, user.id);
  if (!hasil.ok) {
    return NextResponse.json({ error: hasil.error }, { status: hasil.status });
  }
  return NextResponse.json(hasil.data, { status: 201 });
});
