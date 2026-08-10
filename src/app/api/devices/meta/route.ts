import { NextResponse } from "next/server";
import { getDeviceMeta } from "@/server/device-store";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

export const GET = withRole([], async () => {
  return NextResponse.json(await getDeviceMeta());
});
