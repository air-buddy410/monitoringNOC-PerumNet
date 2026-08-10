import { NextResponse } from "next/server";
import type { IncidentsResponse } from "@/server/api-v1/contracts";
import { listIncidents } from "@/server/incident-store";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

const VALID_STATES = ["open", "acknowledged", "resolved"] as const;
const VALID_SEVERITIES = ["ok", "warning", "critical"] as const;

/** GET /api/v1/incidents?state=&severity=&limit= — daftar incident (perlu login). */
export const GET = withRole([], async (request) => {
  const { searchParams } = new URL(request.url);

  const state = searchParams.get("state");
  if (
    state &&
    !VALID_STATES.includes(state as (typeof VALID_STATES)[number])
  ) {
    return NextResponse.json(
      { error: `state tidak valid: ${state}` },
      { status: 400 },
    );
  }
  const severity = searchParams.get("severity");
  if (
    severity &&
    !VALID_SEVERITIES.includes(severity as (typeof VALID_SEVERITIES)[number])
  ) {
    return NextResponse.json(
      { error: `severity tidak valid: ${severity}` },
      { status: 400 },
    );
  }

  const limitRaw = searchParams.get("limit") ?? "50";
  const limit = Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return NextResponse.json(
      { error: `limit tidak valid: ${limitRaw} (1–200)` },
      { status: 400 },
    );
  }

  const page = await listIncidents({
    state: state as "open" | "acknowledged" | "resolved" | undefined,
    severity: severity as "ok" | "warning" | "critical" | undefined,
    limit,
  });

  const body: IncidentsResponse = {
    incidents: page.incidents,
    total: page.total,
  };
  return NextResponse.json(body);
});
