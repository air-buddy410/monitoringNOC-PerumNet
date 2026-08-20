import { NextResponse } from "next/server";
import {
  enumerateMonths,
  getTrafficReport,
  getTrafficReportRange,
  PERIOD_PATTERN,
} from "@/server/reports";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

const MAX_RANGE_MONTHS = 12;

/**
 * GET /api/reports/traffic
 *   ?period=YYYY-MM              → rekap satu bulan
 *   ?from=YYYY-MM&to=YYYY-MM     → agregasi rentang bulan (maks 12 bulan)
 */
export const GET = withRole([], async (request) => {
  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const headers = {
    // Terikat sesi sejak 20 Agustus 2026 — jangan pernah `public`.
    "Cache-Control": "private, max-age=0, must-revalidate",
  };

  if (period) {
    if (!PERIOD_PATTERN.test(period)) {
      return NextResponse.json(
        { error: "period wajib berformat YYYY-MM, mis. 2026-07." },
        { status: 400 },
      );
    }
    return NextResponse.json(await getTrafficReport(period), { headers });
  }

  if (!from || !to || !PERIOD_PATTERN.test(from) || !PERIOD_PATTERN.test(to)) {
    return NextResponse.json(
      {
        error:
          "Sertakan ?period=YYYY-MM, atau ?from=YYYY-MM&to=YYYY-MM untuk rentang.",
      },
      { status: 400 },
    );
  }
  if (from > to) {
    return NextResponse.json(
      { error: "from tidak boleh setelah to." },
      { status: 400 },
    );
  }
  if (enumerateMonths(from, to).length > MAX_RANGE_MONTHS) {
    return NextResponse.json(
      { error: `Rentang maksimal ${MAX_RANGE_MONTHS} bulan.` },
      { status: 400 },
    );
  }

  return NextResponse.json(await getTrafficReportRange(from, to), { headers });
});
