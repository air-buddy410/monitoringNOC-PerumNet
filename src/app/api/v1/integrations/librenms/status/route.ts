import { NextResponse } from "next/server";
import type { LibrenmsStatusResponse } from "@/server/api-v1/contracts";
import { getAssetsWithStatus } from "@/server/device-store";
import {
  fetchActiveAlerts,
  fetchDevices,
  isLibrenmsConfigured,
  LibrenmsError,
} from "@/server/librenms";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/integrations/librenms/status
 * Diagnostik koneksi integrasi (peran admin): konfigurasi, jangkauan API,
 * jumlah perangkat/alert, dan seberapa banyak aset yang terpetakan.
 */
export const GET = withRole(["admin"], async () => {
  const checkedAt = new Date().toISOString();

  if (!isLibrenmsConfigured()) {
    const body: LibrenmsStatusResponse = {
      configured: false,
      reachable: false,
      lastError: null,
      deviceCount: 0,
      alertCount: 0,
      assetCount: 0,
      mappedAssetCount: 0,
      snapshotSource: "fixture",
      checkedAt,
    };
    return NextResponse.json(body);
  }

  let reachable = false;
  let lastError: string | null = null;
  let deviceCount = 0;
  let alertCount = 0;
  try {
    [deviceCount, alertCount] = await Promise.all([
      fetchDevices().then((devices) => devices.length),
      fetchActiveAlerts().then((alerts) => alerts.length),
    ]);
    reachable = true;
  } catch (error) {
    lastError =
      error instanceof LibrenmsError
        ? `${error.message} (HTTP ${error.status ?? "n/a"})`
        : error instanceof Error
          ? error.message
          : String(error);
  }

  const snapshot = await getAssetsWithStatus();
  const mappedAssetCount = snapshot.assets.filter(
    (asset) => asset.librenmsDeviceId != null,
  ).length;

  const body: LibrenmsStatusResponse = {
    configured: true,
    reachable,
    lastError,
    deviceCount,
    alertCount,
    assetCount: snapshot.assets.length,
    mappedAssetCount,
    snapshotSource: snapshot.source,
    checkedAt,
  };
  return NextResponse.json(body);
});
