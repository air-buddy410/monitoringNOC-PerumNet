import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { ipAddresses, subnets } from "@/db/schema";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

/** Bentuk CIDR IPv4 sederhana. Ketat di sini supaya IPAM tidak pelan-pelan
 *  terisi teks bebas yang tidak bisa dihitung. */
export function cidrValid(cidr: string): boolean {
  const m = cidr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
  if (!m) return false;
  const oktet = [m[1], m[2], m[3], m[4]].map(Number);
  if (oktet.some((o) => o > 255)) return false;
  return Number(m[5]) <= 32;
}

/** GET /api/v1/subnets — beserta jumlah alamat terpakai per subnet. */
export const GET = withRole([], async () => {
  const rows = await db
    .select({
      id: subnets.id, cidr: subnets.cidr, name: subnets.name,
      gateway: subnets.gateway, vlanId: subnets.vlanId,
      siteId: subnets.siteId, purpose: subnets.purpose,
      usedCount: sql<number>`count(${ipAddresses.id})::int`,
    })
    .from(subnets)
    .leftJoin(ipAddresses, eq(ipAddresses.subnetId, subnets.id))
    .groupBy(subnets.id)
    .orderBy(subnets.cidr);
  return NextResponse.json({ subnets: rows }, { headers: { "Cache-Control": "no-store" } });
});

export const POST = withRole(["admin", "noc"], async (request) => {
  let body: { cidr?: string; name?: string; gateway?: string; vlanId?: number; siteId?: string; purpose?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body harus JSON yang valid." }, { status: 400 });
  }
  const cidr = body.cidr?.trim();
  const name = body.name?.trim();
  if (!cidr || !name) {
    return NextResponse.json({ error: "cidr dan name wajib diisi." }, { status: 400 });
  }
  if (!cidrValid(cidr)) {
    return NextResponse.json({ error: `"${cidr}" bukan CIDR IPv4 yang sah.` }, { status: 400 });
  }
  try {
    const id = randomUUID();
    await db.insert(subnets).values({
      id, cidr, name,
      gateway: body.gateway?.trim() ?? null,
      vlanId: body.vlanId ?? null,
      siteId: body.siteId ?? null,
      purpose: body.purpose?.trim() ?? null,
    });
    return NextResponse.json({ id, cidr, name }, { status: 201 });
  } catch {
    return NextResponse.json({ error: `Subnet ${cidr} sudah terdaftar.` }, { status: 409 });
  }
});
