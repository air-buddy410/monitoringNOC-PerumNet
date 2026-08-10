import { NextResponse } from "next/server";
import { getLatestDevices } from "@/server/device-store";
import { getOltOptics } from "@/server/metrics-store";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

/**
 * GET /api/devices/:id/olt-optics
 * Grid kesehatan optik OLT: SFP PON (up/down, Tx Power) dan daftar ONU
 * (Rx Power dBm, status Online/Offline/Dying Gasp). Hanya untuk perangkat OLT.
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
    if (device.group !== "OLT") {
      return NextResponse.json(
        { error: `Perangkat ${device.name} bukan OLT — data optik tidak tersedia.` },
        { status: 400 },
      );
    }

    const optics = await getOltOptics(device.id);
    return NextResponse.json(optics, {
      headers: {
        "Cache-Control": "public, s-maxage=10, stale-while-revalidate=5",
      },
    });
  },
);
