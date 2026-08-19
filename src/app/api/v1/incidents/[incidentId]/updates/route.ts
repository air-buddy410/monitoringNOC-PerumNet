import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { incidentUpdates, incidents } from "@/db/schema";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ incidentId: string }> };
const JENIS = ["catatan", "status", "eskalasi", "penyebab", "penutupan"] as const;

/** GET — riwayat sebuah insiden, terlama dulu (dibaca sebagai cerita). */
export const GET = withRole([], async (_r, _u, ctx: Ctx) => {
  const { incidentId } = await ctx.params;
  const rows = await db
    .select().from(incidentUpdates)
    .where(eq(incidentUpdates.incidentId, incidentId))
    .orderBy(incidentUpdates.createdAt);
  return NextResponse.json({ updates: rows }, { headers: { "Cache-Control": "no-store" } });
});

/**
 * POST — tambahkan satu catatan. Append-only: tidak ada ubah maupun hapus.
 *
 * Riwayat gangguan yang bisa disunting kehilangan gunanya justru saat paling
 * dibutuhkan — waktu orang menelusuri ulang apa yang diketahui dan kapan.
 */
export const POST = withRole(["admin", "noc", "engineer"], async (request, user, ctx: Ctx) => {
  const { incidentId } = await ctx.params;
  let body: { body?: string; kind?: (typeof JENIS)[number] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body harus JSON yang valid." }, { status: 400 });
  }
  const isi = body.body?.trim();
  if (!isi) return NextResponse.json({ error: "body wajib diisi." }, { status: 400 });
  const kind = body.kind ?? "catatan";
  if (!JENIS.includes(kind)) {
    return NextResponse.json(
      { error: `kind harus salah satu dari: ${JENIS.join(", ")}.` }, { status: 400 },
    );
  }

  const [ada] = await db
    .select({ id: incidents.id }).from(incidents)
    .where(eq(incidents.id, incidentId)).limit(1);
  if (!ada) return NextResponse.json({ error: "Insiden tidak ditemukan." }, { status: 404 });

  const id = randomUUID();
  await db.insert(incidentUpdates).values({
    id, incidentId, authorUserId: user.id, authorLabel: user.name, kind, body: isi,
  });
  return NextResponse.json({ id, kind }, { status: 201 });
});
