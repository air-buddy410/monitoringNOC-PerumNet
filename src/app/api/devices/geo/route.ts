import { NextResponse } from "next/server";
import { getLatestDevices } from "@/server/device-store";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

/**
 * GET /api/devices/geo
 * Sebaran perangkat sebagai GeoJSON FeatureCollection (WGS84, [lng, lat]) —
 * langsung kompatibel dengan Leaflet/GIS lain. Status ikut di properties
 * untuk pewarnaan marker.
 */
export const GET = withRole([], async () => {
  const snapshot = await getLatestDevices();

  return NextResponse.json(
    {
      type: "FeatureCollection",
      features: snapshot.devices.map((device) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [device.longitude, device.latitude],
        },
        properties: {
          id: device.id,
          name: device.name,
          ip: device.ip,
          group: device.group,
          area: device.area,
          status: device.status,
        },
      })),
      updatedAt: snapshot.updatedAt,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=10, stale-while-revalidate=5",
      },
    },
  );
});
