import { NextResponse } from "next/server";
import type { DiscoveryRunResponse } from "@/server/api-v1/contracts";
import { withRole } from "@/server/rbac";
import { getTopologyDetail, listSuggestions, runDiscovery } from "@/server/topology-store";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/topologies/:topologyId/discovery
 * Jalankan discovery dari relasi/neighbor LibreNMS. Hasil selalu berupa
 * usulan (pending) — node/link manual yang sudah ada tidak pernah diubah.
 * Khusus admin/engineer.
 */
export const POST = withRole<{ params: Promise<{ topologyId: string }> }>(
  ["admin", "engineer"],
  async (_request, _user, { params }) => {
    const { topologyId } = await params;
    const existing = await getTopologyDetail(topologyId);
    if (!existing) {
      return NextResponse.json(
        { error: `Topologi ${topologyId} tidak ditemukan.` },
        { status: 404 },
      );
    }

    let result;
    try {
      result = await runDiscovery(topologyId);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      );
    }

    const suggestions = await listSuggestions(topologyId);
    const body: DiscoveryRunResponse = { ...result, suggestions };
    return NextResponse.json(body);
  },
);
