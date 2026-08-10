import { NextResponse } from "next/server";
import type {
  CrmServiceMappingListResponse,
  CrmServiceMappingRequest,
  CrmServiceMappingResponse,
} from "@/server/api-v1/contracts";
import { listServiceMappings, upsertServiceMapping } from "@/server/crm-store";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/integrations/crm/service-mappings
 * Daftar mapping layanan CRM (khusus admin).
 */
export const GET = withRole(["admin"], async () => {
  const mappings = await listServiceMappings();
  const body: CrmServiceMappingListResponse = {
    mappings,
    total: mappings.length,
  };
  return NextResponse.json(body);
});

/**
 * POST /api/v1/integrations/crm/service-mappings
 * Buat/perbarui mapping customer ↔ layanan ↔ aset/group LibreNMS (khusus
 * admin). Idempoten per (externalCustomerId, externalServiceId).
 */
export const POST = withRole(["admin"], async (request, user) => {
  let raw: CrmServiceMappingRequest;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body harus JSON yang valid." },
      { status: 400 },
    );
  }

  const result = await upsertServiceMapping({
    externalCustomerId: raw.externalCustomerId,
    externalServiceId: raw.externalServiceId,
    assetId: raw.assetId,
    librenmsGroup: raw.librenmsGroup,
    actorUserId: user.id,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const body: CrmServiceMappingResponse = { mapping: result.mapping };
  return NextResponse.json(body, { status: result.created ? 201 : 200 });
});
