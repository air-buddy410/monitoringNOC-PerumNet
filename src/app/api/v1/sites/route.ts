import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { networkSites } from "@/db/schema";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

/** GET /api/v1/sites — daftar lokasi fisik. */
export const GET = withRole([], async () => {
  const rows = await db.select().from(networkSites).orderBy(networkSites.code);
  return NextResponse.json({ sites: rows }, { headers: { "Cache-Control": "no-store" } });
});

/** POST /api/v1/sites — admin & noc. `code` unik; bentrok → 409. */
export const POST = withRole(["admin", "noc"], async (request) => {
  let body: { code?: string; name?: string; address?: string; latitude?: number; longitude?: number; notes?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body harus JSON yang valid." }, { status: 400 });
  }
  const code = body.code?.trim().toUpperCase();
  const name = body.name?.trim();
  if (!code || !name) {
    return NextResponse.json({ error: "code dan name wajib diisi." }, { status: 400 });
  }
  try {
    const id = randomUUID();
    await db.insert(networkSites).values({
      id, code, name,
      address: body.address?.trim() ?? null,
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      notes: body.notes?.trim() ?? null,
    });
    return NextResponse.json({ id, code, name }, { status: 201 });
  } catch {
    return NextResponse.json({ error: `Kode situs ${code} sudah dipakai.` }, { status: 409 });
  }
});
