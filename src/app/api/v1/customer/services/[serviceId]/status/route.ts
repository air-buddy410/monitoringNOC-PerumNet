import { NextResponse } from "next/server";
import { getCustomerServiceStatus } from "@/server/customer-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/customer/services/:serviceId/status?customerId=&token=
 * Status layanan untuk pelanggan (akses publik lewat deep link aman).
 * Token = HMAC(customerId|serviceId) dari CUSTOMER_PORTAL_SECRET.
 * Response di-sanitasi — tidak pernah memuat data internal.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ serviceId: string }> },
) {
  const { serviceId } = await context.params;
  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get("customerId") ?? "";
  const token = searchParams.get("token") ?? "";

  const result = await getCustomerServiceStatus({ customerId, serviceId, token });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.status, {
    headers: {
      "Cache-Control": "public, max-age=30, stale-while-revalidate=15",
    },
  });
}
