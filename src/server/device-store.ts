// Sumber status perangkat di sisi server — snapshot terpusat ber-cache
// TTL 10 detik (berapa pun banyaknya klien, sumber tidak ikut terbebani).
//
// Dua mode:
// - TERHUBUNG (LIBRENMS_URL + LIBRENMS_TOKEN di-set): aset dari tabel
//   `assets` (otoritas Portal), status & metadata live dari LibreNMS API.
// - FIXTURE (default development): drift status acak atas FIXTURE_ASSETS,
//   berlabel jelas — tidak pernah menyentuh jaringan.

import { assetToLegacyDevice, FIXTURE_ASSETS } from "@/lib/fixtures/assets";
import { db } from "@/db";
import { assets as assetsTable, probeTargets } from "@/db/schema";
import { cache } from "@/server/cache";
import {
  enrichAssetFromDevice,
  fetchActiveAlerts,
  fetchDevices,
  isLibrenmsConfigured,
  normalizeActiveAlert,
  statusFromDevice,
} from "@/server/librenms";
import type { Asset } from "@/types/asset";
import type {
  DeviceGroup,
  DeviceStatus,
  NetworkDevice,
} from "@/types/device";

const SNAPSHOT_CACHE_KEY = "devices:snapshot";
const SNAPSHOT_TTL_SECONDS = 10;

export type SnapshotSource = "librenms" | "fixture";

export interface AssetsStatusSnapshot {
  assets: Asset[];
  updatedAt: string;
  source: SnapshotSource;
}

export interface DevicesSnapshot {
  devices: NetworkDevice[];
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Mode FIXTURE — drift status acak (DEVELOPMENT FIXTURE, bukan data nyata).
// ---------------------------------------------------------------------------

const STATUSES: DeviceStatus[] = ["online", "warning", "offline"];
const fixtureStatuses = new Map<string, DeviceStatus>(
  FIXTURE_ASSETS.map((asset) => [asset.assetId, asset.status]),
);
let fixtureModeLogged = false;

function buildFixtureSnapshot(): AssetsStatusSnapshot {
  if (!fixtureModeLogged) {
    fixtureModeLogged = true;
    console.log(
      "[librenms] LIBRENMS_URL/TOKEN tidak di-set — status perangkat memakai FIXTURE development.",
    );
  }
  for (const [assetId, status] of fixtureStatuses) {
    if (Math.random() >= 0.85) {
      fixtureStatuses.set(
        assetId,
        STATUSES[Math.floor(Math.random() * STATUSES.length)] ?? status,
      );
    }
  }
  return {
    assets: FIXTURE_ASSETS.map((asset) => ({
      ...asset,
      status: fixtureStatuses.get(asset.assetId) ?? asset.status,
    })),
    updatedAt: new Date().toISOString(),
    source: "fixture",
  };
}

// ---------------------------------------------------------------------------
// Mode TERHUBUNG — tabel assets (otoritas Portal) + status live LibreNMS.
// ---------------------------------------------------------------------------

async function loadAssetsFromDb(): Promise<Asset[]> {
  const rows = await db.select().from(assetsTable);
  return rows.map((row) => ({
    assetId: row.assetId,
    librenmsDeviceId: row.librenmsDeviceId,
    hostname: row.hostname,
    displayName: row.displayName,
    managementIp: row.managementIp,
    vendor: row.vendor,
    os: row.os,
    model: row.model,
    serialNumber: row.serialNumber,
    site: row.site,
    location: row.location,
    latitude: row.latitude,
    longitude: row.longitude,
    tags: row.tags,
    networkRole: row.networkRole,
    // Placeholder — diisi dari status LibreNMS di buildLibrenmsSnapshot.
    status: "warning",
    crmRef:
      row.crmCustomerId && row.crmServiceId
        ? { customerId: row.crmCustomerId, serviceId: row.crmServiceId }
        : null,
  }));
}

/**
 * Status aset dari hasil probe TCP, untuk aset yang TIDAK dipantau SNMP.
 *
 * Nilai yang tidak dikenal — termasuk yang belum pernah diperiksa — jatuh ke
 * `warning`, bukan `online`. Menebak ke arah "sehat" membuat layar berbohong
 * ke arah yang paling menenangkan, dan itu arah yang paling mahal.
 */
export function statusDariProbe(
  lastStatus: string | null | undefined,
): DeviceStatus {
  if (lastStatus === "UP") return "online";
  if (lastStatus === "DOWN") return "offline";
  return "warning";
}

/** Hasil probe terakhir per `asset_id`, hanya untuk sasaran yang aktif. */
async function loadProbeStatuses(): Promise<Map<string, DeviceStatus>> {
  try {
    const rows = await db
      .select({
        assetId: probeTargets.assetId,
        lastStatus: probeTargets.lastStatus,
        isActive: probeTargets.isActive,
      })
      .from(probeTargets);
    const peta = new Map<string, DeviceStatus>();
    for (const row of rows) {
      if (!row.assetId || !row.isActive) continue;
      peta.set(row.assetId, statusDariProbe(row.lastStatus));
    }
    return peta;
  } catch {
    // Probe adalah sumber CADANGAN. Kalau ia gagal dibaca, jangan jatuhkan
    // seluruh daftar perangkat — kembalikan kosong dan biarkan perilaku lama.
    return new Map();
  }
}

async function buildLibrenmsSnapshot(): Promise<AssetsStatusSnapshot> {
  const [dbAssets, devices, alertRows, probeStatuses] = await Promise.all([
    loadAssetsFromDb(),
    fetchDevices(),
    fetchActiveAlerts(),
    loadProbeStatuses(),
  ]);

  const byDeviceId = new Map(devices.map((device) => [device.device_id, device]));
  const byHostname = new Map(
    devices.map((device) => [device.hostname.toLowerCase(), device]),
  );
  const alertedDeviceIds = new Set(
    alertRows
      .map(normalizeActiveAlert)
      .filter((alert) => alert !== null)
      .map((alert) => alert.librenmsDeviceId),
  );

  const assets = dbAssets.map((asset) => {
    const device =
      (asset.librenmsDeviceId != null
        ? byDeviceId.get(asset.librenmsDeviceId)
        : undefined) ?? byHostname.get(asset.hostname.toLowerCase());
    if (!device) {
      // Aset tidak dikenal LibreNMS. Dua sebab yang berbeda jauh:
      //
      //   1. Salah konfigurasi — memang butuh perhatian operator.
      //   2. Perangkatnya TIDAK mendukung SNMP dan memang tidak akan pernah
      //      masuk LibreNMS (192.168.100.10, lihat OPERATIONS §11.1).
      //
      // Untuk yang kedua, `warning` tidak pernah bisa berubah jadi hijau —
      // dan warna peringatan yang tidak pernah berubah mengajari orang
      // mengabaikan warna peringatan. Probe TCP portal ini sudah memeriksa
      // perangkat itu tiap 60 detik; kalau ada hasilnya, itu yang dipakai.
      const dariProbe = probeStatuses.get(asset.assetId);
      return { ...asset, status: dariProbe ?? ("warning" as const) };
    }
    return {
      ...enrichAssetFromDevice(asset, device),
      librenmsDeviceId: device.device_id,
      status: statusFromDevice(device, alertedDeviceIds.has(device.device_id)),
    };
  });

  return { assets, updatedAt: new Date().toISOString(), source: "librenms" };
}

// ---------------------------------------------------------------------------
// API publik store
// ---------------------------------------------------------------------------

/**
 * Snapshot aset + status terbaru, read-through cache ber-TTL 10 detik:
 * selama TTL hidup semua klien mendapat snapshot yang sama tanpa menyentuh
 * sumber; setelah kedaluwarsa, sinkronisasi berikutnya mengisi ulang cache.
 */
export async function getAssetsWithStatus(): Promise<AssetsStatusSnapshot> {
  const cached = await cache.get<AssetsStatusSnapshot>(SNAPSHOT_CACHE_KEY);
  if (cached) return cached;

  const snapshot = isLibrenmsConfigured()
    ? await buildLibrenmsSnapshot()
    : buildFixtureSnapshot();
  await cache.set(SNAPSHOT_CACHE_KEY, snapshot, SNAPSHOT_TTL_SECONDS);
  return snapshot;
}

/** Proyeksi legacy `NetworkDevice` — dipakai UI lama sampai pindah ke v1 (F7). */
export async function getLatestDevices(): Promise<DevicesSnapshot> {
  const { assets, updatedAt } = await getAssetsWithStatus();
  return { devices: assets.map(assetToLegacyDevice), updatedAt };
}

export interface DeviceMeta {
  areas: string[];
  groups: DeviceGroup[];
}

/** Daftar unik area & jenis perangkat — untuk mengisi kontrol filter peta. */
export async function getDeviceMeta(): Promise<DeviceMeta> {
  const { devices } = await getLatestDevices();
  return {
    areas: [...new Set(devices.map((device) => device.area))].sort(),
    groups: [...new Set(devices.map((device) => device.group))].sort(),
  };
}
