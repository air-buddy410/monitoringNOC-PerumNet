import { NextResponse } from "next/server";
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
