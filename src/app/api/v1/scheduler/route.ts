import { NextResponse } from "next/server";
import { db } from "@/db";
import { scheduledTasks } from "@/db/schema";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/scheduler — keadaan tiap pekerjaan terjadwal.
 *
 * Ada supaya pertanyaan "worker-nya masih hidup atau tidak" bisa dijawab dari
 * layar, bukan dengan SSH ke server. `staleness` diturunkan dari `lastRunAt`
 * terhadap intervalnya: worker yang mati tidak menghasilkan galat apa pun —
 * yang tersisa cuma baris yang tidak pernah diperbarui.
 */
export const GET = withRole([], async () => {
  const rows = await db.select().from(scheduledTasks).orderBy(scheduledTasks.code);
  const now = Date.now();

  const tasks = rows.map((t) => {
    const terlambatDetik = t.lastRunAt
      ? Math.max(0, Math.round((now - t.lastRunAt.getTime()) / 1000) - t.intervalSec)
      : null;
    return {
      code: t.code,
      name: t.name,
      description: t.description,
      isEnabled: t.isEnabled,
      intervalSec: t.intervalSec,
      lastRunAt: t.lastRunAt?.toISOString() ?? null,
      lastStatus: t.lastStatus,
      lastError: t.lastError,
      lastDurationMs: t.lastDurationMs,
      runCount: t.runCount,
      failCount: t.failCount,
      /** Detik keterlambatan di luar intervalnya; null bila belum pernah jalan. */
      overdueSec: terlambatDetik,
      /** Toleransi 3× interval sebelum disebut macet — satu putaran yang
       *  kelewat bukan kerusakan. */
      stalled: t.isEnabled && terlambatDetik !== null && terlambatDetik > t.intervalSec * 3,
    };
  });

  return NextResponse.json(
    {
      workerLikelyDown: tasks.some((t) => t.stalled),
      tasks,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
