import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ipAddresses, subnets } from "@/db/schema";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ subnetId: string }> };

export const GET = withRole([], async (_r, _u, ctx: Ctx) => {
  const { subnetId } = await ctx.params;
  const rows = await db
    .select().from(ipAddresses)
    .where(eq(ipAddresses.subnetId, subnetId))
    .orderBy(ipAddresses.address);
  return NextResponse.json({ addresses: rows }, { headers: { "Cache-Control": "no-store" } });
});

export const POST = withRole(["admin", "noc"], async (request, _u, ctx: Ctx) => {
  const { subnetId } = await ctx.params;
  let body: { address?: string; assetId?: string; label?: string; status?: "dipakai" | "dicadangkan" | "bebas" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body harus JSON yang valid." }, { status: 400 });
  }
  const address = body.address?.trim();
  if (!address) {
    return NextResponse.json({ error: "address wajib diisi." }, { status: 400 });
  }

  const [ada] = await db.select({ id: subnets.id }).from(subnets).where(eq(subnets.id, subnetId)).limit(1);
  if (!ada) return NextResponse.json({ error: "Subnet tidak ditemukan." }, { status: 404 });

  try {
    const id = randomUUID();
    await db.insert(ipAddresses).values({
      id, subnetId, address,
      assetId: body.assetId ?? null,
      label: body.label?.trim() ?? null,
      status: body.status ?? "dipakai",
    });
    return NextResponse.json({ id, address }, { status: 201 });
  } catch {
    // Unik per (subnet, address) — alamat privat yang sama sah ada di subnet lain.
    return NextResponse.json(
      { error: `${address} sudah tercatat di subnet ini.` }, { status: 409 },
    );
  }
});
