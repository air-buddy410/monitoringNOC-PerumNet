import { NextResponse } from "next/server";
import { getLatestDevices } from "@/server/device-store";
import { getDeviceMetrics } from "@/server/metrics-store";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

/**
 * GET /api/devices/:id/metrics
 * Metrik dasar perangkat (CPU/RAM, suhu, bandwidth per port) dari cache
 * ber-TTL 10 detik.
 */
export const GET = withRole<{ params: Promise<{ id: string }> }>(
  [],
  async (_request, _user, { params }) => {
    const { id } = await params;

    const snapshot = await getLatestDevices();
    const device = snapshot.devices.find((item) => item.id === id);
    if (!device) {
      return NextResponse.json(
        { error: `Perangkat dengan ID ${id} tidak ditemukan.` },
        { status: 404 },
      );
    }

    const metrics = await getDeviceMetrics(device.id, device.group);
    return NextResponse.json(metrics, {
      headers: {
        "Cache-Control": "public, s-maxage=10, stale-while-revalidate=5",
      },
    });
  },
);
