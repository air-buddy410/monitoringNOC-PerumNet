import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { odpPorts, odps } from "@/db/schema";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/ftth/odps
 *
 * `usedPorts` DITURUNKAN dari tabel port, bukan disimpan sebagai kolom —
 * supaya tidak pernah ada dua angka yang berbeda tentang hal yang sama.
 */
export const GET = withRole([], async () => {
  const rows = await db
    .select({
      id: odps.id, code: odps.code, name: odps.name,
      siteId: odps.siteId, oltId: odps.oltId,
      latitude: odps.latitude, longitude: odps.longitude,
      capacity: odps.capacity,
      usedPorts: sql<number>`count(${odpPorts.id}) filter (where ${odpPorts.status} = 'terpakai')::int`,
      brokenPorts: sql<number>`count(${odpPorts.id}) filter (where ${odpPorts.status} = 'rusak')::int`,
    })
    .from(odps)
    .leftJoin(odpPorts, eq(odpPorts.odpId, odps.id))
    .groupBy(odps.id)
    .orderBy(odps.code);
  return NextResponse.json({ odps: rows }, { headers: { "Cache-Control": "no-store" } });
});

/** POST — membuat ODP sekaligus port-portnya sebanyak `capacity`. */
export const POST = withRole(["admin", "noc"], async (request) => {
  let body: { code?: string; name?: string; siteId?: string; oltId?: string; capacity?: number; latitude?: number; longitude?: number };
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
  const capacity = body.capacity ?? 8;
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 256) {
    return NextResponse.json({ error: "capacity harus 1–256." }, { status: 400 });
  }

  try {
    const id = randomUUID();
    await db.insert(odps).values({
      id, code, name,
      siteId: body.siteId ?? null, oltId: body.oltId ?? null,
      latitude: body.latitude ?? null, longitude: body.longitude ?? null,
      capacity,
    });
    // Port dibuat sekaligus: ODP tanpa port tidak bisa dipetakan, dan membuat
    // port satu per satu lewat UI adalah pekerjaan yang tidak perlu ada.
    await db.insert(odpPorts).values(
      Array.from({ length: capacity }, (_, i) => ({
        id: randomUUID(), odpId: id, portNumber: i + 1, status: "kosong" as const,
      })),
    );
    return NextResponse.json({ id, code, name, capacity }, { status: 201 });
  } catch {
    return NextResponse.json({ error: `Kode ODP ${code} sudah dipakai.` }, { status: 409 });
  }
});
