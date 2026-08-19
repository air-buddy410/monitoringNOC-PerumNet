import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { pppoePollRuns, pppoeSessions } from "@/db/schema";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/pppoe/sessions
 *
 * Gambaran "siapa online menurut penarikan TERAKHIR". `lastRun` disertakan
 * supaya umur data terlihat: daftar sesi yang tidak diperbarui terlihat persis
 * sama dengan jaringan yang stabil, dan itu bahaya.
 */
export const GET = withRole([], async () => {
  const [lastRun] = await db
    .select().from(pppoePollRuns)
    .orderBy(desc(pppoePollRuns.startedAt)).limit(1);

  const rows = await db
    .select().from(pppoeSessions)
    .orderBy(pppoeSessions.username).limit(2000);

  return NextResponse.json(
    {
      lastRun: lastRun
        ? {
            status: lastRun.status,
            startedAt: lastRun.startedAt.toISOString(),
            finishedAt: lastRun.finishedAt?.toISOString() ?? null,
            sessionCount: lastRun.sessionCount,
            error: lastRun.error,
          }
        : null,
      sessions: rows.map((s) => ({
        username: s.username,
        address: s.address,
        callerId: s.callerId,
        uptimeSec: s.uptimeSec,
        routerName: s.routerName,
        seenAt: s.seenAt.toISOString(),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
