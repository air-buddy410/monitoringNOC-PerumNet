import { NextResponse } from "next/server";
import type {
  CreateTopologyRequest,
  TopologyListResponse,
} from "@/server/api-v1/contracts";
import { withRole } from "@/server/rbac";
import { createTopology, listTopologies } from "@/server/topology-store";

export const dynamic = "force-dynamic";

const MAX_NAME_LENGTH = 120;

/** GET /api/v1/topologies — daftar topologi (admin/noc/engineer). */
export const GET = withRole(["admin", "noc", "engineer"], async () => {
  const topologies = await listTopologies();
  const body: TopologyListResponse = {
    topologies,
    total: topologies.length,
  };
  return NextResponse.json(body);
});

/** POST /api/v1/topologies — buat topologi baru (admin/engineer). */
export const POST = withRole(["admin", "engineer"], async (request, user) => {
  let raw: CreateTopologyRequest;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body harus JSON yang valid." },
      { status: 400 },
    );
  }

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) {
    return NextResponse.json(
      { error: "Nama topologi wajib diisi." },
      { status: 400 },
    );
  }
  if (name.length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      { error: `Nama topologi maksimal ${MAX_NAME_LENGTH} karakter.` },
      { status: 400 },
    );
  }

  const detail = await createTopology({ name, userId: user.id });
  return NextResponse.json({ detail }, { status: 201 });
});
