import { NextResponse } from "next/server";
import type { PublishTopologyResponse } from "@/server/api-v1/contracts";
import { withRole } from "@/server/rbac";
import { publishTopology } from "@/server/topology-store";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/topologies/:topologyId/publish
 * Terbitkan versi baru (snapshot node+link). Draft tetap tersimpan;
 * operasional memakai versi published terakhir. Khusus admin/engineer.
 */
export const POST = withRole<{ params: Promise<{ topologyId: string }> }>(
  ["admin", "engineer"],
  async (_request, user, { params }) => {
    const { topologyId } = await params;
    const result = await publishTopology(topologyId, user.id);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.error.includes("tidak ditemukan") ? 404 : 400 },
      );
    }
    const body: PublishTopologyResponse = { topology: result.topology };
    return NextResponse.json(body);
  },
);
