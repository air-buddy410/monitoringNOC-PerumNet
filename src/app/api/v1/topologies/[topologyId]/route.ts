import { NextResponse } from "next/server";
import type {
  TopologyPatchRequest,
  TopologyPatchResponse,
} from "@/server/api-v1/contracts";
import { withRole } from "@/server/rbac";
import {
  getTopologyDetail,
  patchTopology,
  renameTopology,
} from "@/server/topology-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/topologies/:topologyId — detail (node + link) untuk
 * admin/noc/engineer. NOC dapat melihat; customer tidak pernah.
 */
export const GET = withRole<{ params: Promise<{ topologyId: string }> }>(
  ["admin", "noc", "engineer"],
  async (_request, _user, { params }) => {
    const { topologyId } = await params;
    const detail = await getTopologyDetail(topologyId);
    if (!detail) {
      return NextResponse.json(
        { error: `Topologi ${topologyId} tidak ditemukan.` },
        { status: 404 },
      );
    }
    return NextResponse.json({ detail });
  },
);

/**
 * PATCH /api/v1/topologies/:topologyId — rename dan/atau aksi edit manual
 * (add/move/remove node, add/update/remove link) dalam satu transaksi.
 * Khusus admin/engineer.
 */
export const PATCH = withRole<{ params: Promise<{ topologyId: string }> }>(
  ["admin", "engineer"],
  async (request, user, { params }) => {
    const { topologyId } = await params;

    let raw: TopologyPatchRequest;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Body harus JSON yang valid." },
        { status: 400 },
      );
    }

    if (raw.name != null && !raw.name.trim()) {
      return NextResponse.json(
        { error: "Nama topologi tidak boleh kosong." },
        { status: 400 },
      );
    }
    if (!raw.name && !Array.isArray(raw.actions)) {
      return NextResponse.json(
        { error: "Tidak ada perubahan (name/actions)." },
        { status: 400 },
      );
    }
    if (raw.name) {
      const renamed = await renameTopology(topologyId, raw.name, user.id);
      if (!renamed) {
        return NextResponse.json(
          { error: `Topologi ${topologyId} tidak ditemukan.` },
          { status: 404 },
        );
      }
    }

    if (Array.isArray(raw.actions)) {
      const result = await patchTopology({
        topologyId,
        userId: user.id,
        actions: raw.actions,
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      const body: TopologyPatchResponse = { detail: result.detail };
      return NextResponse.json(body);
    }

    const detail = await getTopologyDetail(topologyId);
    return NextResponse.json({ detail });
  },
);
