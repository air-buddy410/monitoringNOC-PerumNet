import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { networkAlarms } from "@/db/schema";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/alarms/:alarmId/acknowledge
 *
 * Menandai alarm sudah dilihat orang. TIDAK menutupnya — penutupan hanya boleh
 * terjadi karena sasarannya benar-benar pulih, supaya "sudah dilihat" tidak
 * pernah tertukar dengan "sudah beres".
 */
export const POST = withRole(
  ["admin", "noc", "engineer"],
  async (_request, user, ctx: { params: Promise<{ alarmId: string }> }) => {
    const { alarmId } = await ctx.params;

    const [row] = await db
      .update(networkAlarms)
      .set({ acknowledgedAt: new Date(), acknowledgedBy: user.id })
      .where(
        and(
          eq(networkAlarms.id, alarmId),
          isNull(networkAlarms.acknowledgedAt),
          isNull(networkAlarms.clearedAt),
        ),
      )
      .returning({ id: networkAlarms.id, alarmNumber: networkAlarms.alarmNumber });

    if (!row) {
      return NextResponse.json(
        { error: "Alarm tidak ditemukan, sudah ditandai, atau sudah ditutup." },
        { status: 404 },
      );
    }
    return NextResponse.json({ id: row.id, alarmNumber: row.alarmNumber, acknowledged: true });
  },
);
