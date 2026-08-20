import { NextResponse } from "next/server";
import { getSlaReport, PERIOD_PATTERN } from "@/server/reports";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

/**
 * GET /api/reports/sla?period=YYYY-MM
 * Laporan ketersediaan SLA bulanan per perangkat (terburuk lebih dulu).
 */
export const GET = withRole([], async (request) => {
  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period");

  if (!period || !PERIOD_PATTERN.test(period)) {
    return NextResponse.json(
      { error: "period wajib berformat YYYY-MM, mis. 2026-07." },
      { status: 400 },
    );
  }

  return NextResponse.json(await getSlaReport(period), {
    headers: {
      // Terikat sesi sejak 20 Agustus 2026 — jangan pernah `public`.
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
});
