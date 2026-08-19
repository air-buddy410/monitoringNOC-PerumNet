import { NextResponse } from "next/server";
import { desc, isNull } from "drizzle-orm";
import { db } from "@/db";
import { networkAlarms } from "@/db/schema";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/alarms — alarm yang disimpulkan portal ini sendiri.
 *
 * Beda dari `/api/v1/incidents`: yang itu apa yang DIKATAKAN LibreNMS lewat
 * webhook, yang ini apa yang portal SIMPULKAN dari probe-nya sendiri.
 * `?semua=1` untuk ikut menampilkan yang sudah ditutup.
 */
export const GET = withRole([], async (request) => {
  const semua = new URL(request.url).searchParams.get("semua") === "1";
  const q = db.select().from(networkAlarms).$dynamic();
  const rows = await (semua ? q : q.where(isNull(networkAlarms.clearedAt)))
    .orderBy(desc(networkAlarms.occurredAt))
    .limit(200);

  return NextResponse.json(
    {
      alarms: rows.map((a) => ({
        id: a.id,
        alarmNumber: a.alarmNumber,
        severity: a.severity,
        source: a.source,
        assetId: a.assetId,
        message: a.message,
        count: a.count,
        occurredAt: a.occurredAt.toISOString(),
        lastSeenAt: a.lastSeenAt.toISOString(),
        acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
        clearedAt: a.clearedAt?.toISOString() ?? null,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
