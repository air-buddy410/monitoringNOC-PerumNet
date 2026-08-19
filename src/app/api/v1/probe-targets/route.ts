import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { probeTargets } from "@/db/schema";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

/** GET /api/v1/probe-targets — daftar sasaran probe beserta keadaan terakhirnya. */
export const GET = withRole([], async () => {
  const rows = await db
    .select()
    .from(probeTargets)
    .orderBy(desc(probeTargets.isActive), probeTargets.name);

  return NextResponse.json(
    {
      targets: rows.map((t) => ({
        id: t.id,
        name: t.name,
        address: t.address,
        port: t.port,
        assetId: t.assetId,
        severity: t.severity,
        isActive: t.isActive,
        status: t.lastStatus,
        latencyMs: t.lastLatencyMs,
        consecutiveFails: t.consecutiveFails,
        failThreshold: t.failThreshold,
        checkedAt: t.lastCheckedAt?.toISOString() ?? null,
        hasOpenAlarm: t.openAlarmId !== null,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});

interface BuatBody {
  name?: string;
  address?: string;
  port?: number;
  assetId?: string | null;
  severity?: "warning" | "critical";
  intervalSec?: number;
  timeoutMs?: number;
  failThreshold?: number;
}

/**
 * POST /api/v1/probe-targets — daftarkan sasaran baru. Admin & NOC saja.
 *
 * Menulis ke database portal sendiri, bukan aksi keluar: yang dilakukan probe
 * cuma membuka koneksi TCP lalu menutupnya.
 */
export const POST = withRole(["admin", "noc"], async (request) => {
  let body: BuatBody;
  try {
    body = (await request.json()) as BuatBody;
  } catch {
    return NextResponse.json({ error: "Body harus JSON yang valid." }, { status: 400 });
  }

  const name = body.name?.trim();
  const address = body.address?.trim();
  if (!name || !address) {
    return NextResponse.json({ error: "name dan address wajib diisi." }, { status: 400 });
  }

  const port = body.port ?? 443;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return NextResponse.json({ error: "port harus 1–65535." }, { status: 400 });
  }

  // Ambang di bawah 1 berarti satu paket hilang langsung membangunkan orang;
  // interval di bawah 10 detik membanjiri perangkat yang sedang bermasalah
  // justru saat ia paling rapuh.
  const failThreshold = body.failThreshold ?? 3;
  const intervalSec = body.intervalSec ?? 60;
  if (!Number.isInteger(failThreshold) || failThreshold < 1) {
    return NextResponse.json({ error: "failThreshold minimal 1." }, { status: 400 });
  }
  if (!Number.isInteger(intervalSec) || intervalSec < 10) {
    return NextResponse.json({ error: "intervalSec minimal 10 detik." }, { status: 400 });
  }

  const id = randomUUID();
  await db.insert(probeTargets).values({
    id,
    name,
    address,
    port,
    assetId: body.assetId ?? null,
    severity: body.severity ?? "critical",
    intervalSec,
    timeoutMs: body.timeoutMs ?? 3000,
    failThreshold,
  });

  return NextResponse.json({ id, name, address, port }, { status: 201 });
});
