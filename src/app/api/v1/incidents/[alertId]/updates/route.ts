import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { eq, or } from "drizzle-orm";
import { db } from "@/db";
import { incidentUpdates, incidents } from "@/db/schema";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ alertId: string }> };

/** Sama seperti rute acknowledge di sebelahnya, `:alertId` menerima ID internal
 *  incident MAUPUN librenmsAlertId. Slug-nya WAJIB bernama sama dengan
 *  saudaranya — Next menolak dua nama slug berbeda pada jalur yang sama, dan
 *  penolakannya terjadi saat RUNTIME, bukan saat build. */
async function cariIncidentId(ref: string): Promise<string | null> {
  const [row] = await db
    .select({ id: incidents.id })
    .from(incidents)
    .where(or(eq(incidents.id, ref), eq(incidents.librenmsAlertId, ref)))
    .limit(1);
  return row?.id ?? null;
}
const JENIS = ["catatan", "status", "eskalasi", "penyebab", "penutupan"] as const;

/** GET — riwayat sebuah insiden, terlama dulu (dibaca sebagai cerita). */
export const GET = withRole([], async (_r, _u, ctx: Ctx) => {
  const { alertId } = await ctx.params;
  const incidentId = await cariIncidentId(alertId);
  if (!incidentId) return NextResponse.json({ updates: [] }, { headers: { "Cache-Control": "no-store" } });
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
  const { alertId } = await ctx.params;
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

  const incidentId = await cariIncidentId(alertId);
  if (!incidentId) {
    return NextResponse.json({ error: "Insiden tidak ditemukan." }, { status: 404 });
  }

  const id = randomUUID();
  await db.insert(incidentUpdates).values({
    id, incidentId, authorUserId: user.id, authorLabel: user.name, kind, body: isi,
  });
  return NextResponse.json({ id, kind }, { status: 201 });
});
