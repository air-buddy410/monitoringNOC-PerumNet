import { NextResponse } from "next/server";
import { withRole } from "@/server/rbac";
import { buatClosure, daftarClosure } from "@/server/closure-store";
import type { BuatClosureInput } from "@/server/closure-store";

export const dynamic = "force-dynamic";

export const GET = withRole([], async () => {
  const closures = await daftarClosure();
  return NextResponse.json({ closures }, { headers: { "Cache-Control": "no-store" } });
});

export const POST = withRole(["admin", "noc"], async (request, user) => {
  let body: BuatClosureInput;
  try {
    body = (await request.json()) as BuatClosureInput;
  } catch {
    return NextResponse.json({ error: "Body harus JSON yang valid." }, { status: 400 });
  }
  if (body.type && !["inline", "dome", "lain"].includes(body.type)) {
    return NextResponse.json({ error: "type harus inline, dome, atau lain." }, { status: 400 });
  }

  const hasil = await buatClosure(body, user.id);
  if (!hasil.ok) return NextResponse.json({ error: hasil.error }, { status: hasil.status });
  return NextResponse.json(hasil.data, { status: 201 });
});
