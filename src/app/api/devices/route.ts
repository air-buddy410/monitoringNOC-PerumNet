import { NextResponse } from "next/server";
import { getDeviceMeta, getLatestDevices } from "@/server/device-store";
import type { DeviceStatus } from "@/types/device";
import { withRole } from "@/server/rbac";

// Snapshot selalu diambil dari store server, jangan di-cache statis oleh Next.
export const dynamic = "force-dynamic";

const VALID_STATUSES: DeviceStatus[] = ["online", "warning", "offline"];

// Perangkat bermasalah didahulukan (untuk tabel wallboard NOC).
const SEVERITY_ORDER: Record<DeviceStatus, number> = {
  offline: 0,
  warning: 1,
  online: 2,
};

const VALID_SORTS = ["severity", "name"] as const;
type SortKey = (typeof VALID_SORTS)[number];

/**
 * GET /api/devices
 * Query opsional:
 *   ?area=<nama>&group=<jenis>&status=<online|warning|offline>&q=<cari>
 *   &sort=<severity|name>
 * Tanpa query mengembalikan seluruh perangkat. `total` = jumlah sebelum filter.
 */
export const GET = withRole([], async (request) => {
  const { searchParams } = new URL(request.url);
  const area = searchParams.get("area");
  const group = searchParams.get("group");
  const status = searchParams.get("status");
  const query = searchParams.get("q")?.trim().toLowerCase();
  const sort = searchParams.get("sort");

  const meta = await getDeviceMeta();
  if (area && area !== "all" && !meta.areas.includes(area)) {
    return NextResponse.json(
      { error: `Area tidak dikenal: ${area}` },
      { status: 400 },
    );
  }
  if (
    group &&
    group !== "all" &&
    !meta.groups.includes(group as (typeof meta.groups)[number])
  ) {
    return NextResponse.json(
      { error: `Jenis perangkat tidak dikenal: ${group}` },
      { status: 400 },
    );
  }
  if (
    status &&
    status !== "all" &&
    !VALID_STATUSES.includes(status as DeviceStatus)
  ) {
    return NextResponse.json(
      { error: `Status tidak dikenal: ${status}` },
      { status: 400 },
    );
  }
  if (sort && !VALID_SORTS.includes(sort as SortKey)) {
    return NextResponse.json(
      { error: `Sort tidak dikenal: ${sort}` },
      { status: 400 },
    );
  }

  const snapshot = await getLatestDevices();
  let devices = snapshot.devices;
  if (area && area !== "all") {
    devices = devices.filter((device) => device.area === area);
  }
  if (group && group !== "all") {
    devices = devices.filter((device) => device.group === group);
  }
  if (status && status !== "all") {
    devices = devices.filter((device) => device.status === status);
  }
  if (query) {
    devices = devices.filter(
      (device) =>
        device.name.toLowerCase().includes(query) ||
        device.ip.includes(query),
    );
  }
  if (sort === "severity") {
    devices = [...devices].sort(
      (a, b) =>
        SEVERITY_ORDER[a.status] - SEVERITY_ORDER[b.status] ||
        a.name.localeCompare(b.name),
    );
  } else if (sort === "name") {
    devices = [...devices].sort((a, b) => a.name.localeCompare(b.name));
  }

  return NextResponse.json(
    {
      devices,
      total: snapshot.devices.length,
      updatedAt: snapshot.updatedAt,
    },
    {
      headers: {
        // CDN/proxy boleh menahan 10 detik — meredam lonjakan banyak layar NOC.
        "Cache-Control": "public, s-maxage=10, stale-while-revalidate=5",
      },
    },
  );
});
