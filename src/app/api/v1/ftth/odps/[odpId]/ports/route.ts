import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { odpPorts } from "@/db/schema";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ odpId: string }> };

export const GET = withRole([], async (_r, _u, ctx: Ctx) => {
  const { odpId } = await ctx.params;
  const rows = await db
    .select().from(odpPorts)
    .where(eq(odpPorts.odpId, odpId))
    .orderBy(odpPorts.portNumber);
  return NextResponse.json({ ports: rows }, { headers: { "Cache-Control": "no-store" } });
});

/**
 * PATCH — ubah satu port. Body: `{ portNumber, status?, externalServiceId?, notes? }`.
 *
 * `externalServiceId` adalah identitas layanan di sistem LAIN. Portal ini
 * sengaja tidak menyimpan nama maupun alamat pelanggan — repo ini publik.
 */
export const PATCH = withRole(["admin", "noc", "engineer"], async (request, _u, ctx: Ctx) => {
  const { odpId } = await ctx.params;
  let body: { portNumber?: number; status?: "kosong" | "terpakai" | "rusak" | "dicadangkan"; externalServiceId?: string | null; notes?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body harus JSON yang valid." }, { status: 400 });
  }
  if (!Number.isInteger(body.portNumber)) {
    return NextResponse.json({ error: "portNumber wajib diisi." }, { status: 400 });
  }

  const perubahan: Record<string, unknown> = { updatedAt: new Date() };
  if (body.status) perubahan.status = body.status;
  if (body.externalServiceId !== undefined) perubahan.externalServiceId = body.externalServiceId;
  if (body.notes !== undefined) perubahan.notes = body.notes;

  const [row] = await db
    .update(odpPorts)
    .set(perubahan)
    .where(and(eq(odpPorts.odpId, odpId), eq(odpPorts.portNumber, body.portNumber!)))
    .returning({ id: odpPorts.id, portNumber: odpPorts.portNumber, status: odpPorts.status });

  if (!row) return NextResponse.json({ error: "Port tidak ditemukan pada ODP ini." }, { status: 404 });
  return NextResponse.json(row);
});
