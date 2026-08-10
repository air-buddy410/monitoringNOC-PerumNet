import { NextResponse } from "next/server";
import { getLatestDevices } from "@/server/device-store";
import { getDeviceMetrics, getOltOptics } from "@/server/metrics-store";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

/**
 * GET /api/devices/:id/live
 * Sumber tunggal polling real-time halaman detail: identitas + status
 * terkini, metrik dasar, dan (khusus OLT) grid optik — satu permintaan per
 * siklus 10 detik, semuanya dari cache.
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

    const [metrics, optics] = await Promise.all([
      getDeviceMetrics(device.id, device.group),
      device.group === "OLT" ? getOltOptics(device.id) : Promise.resolve(null),
    ]);

    return NextResponse.json(
      {
        device,
        metrics,
        optics,
        updatedAt: snapshot.updatedAt,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=10, stale-while-revalidate=5",
        },
      },
    );
  },
);
