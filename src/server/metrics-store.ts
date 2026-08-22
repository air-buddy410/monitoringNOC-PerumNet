// Metrik dasar per perangkat di sisi server, read-through cache TTL 10 detik.
//
// Dua mode:
// - TERHUBUNG (LIBRENMS_URL + LIBRENMS_TOKEN): nilai live dari LibreNMS
//   (CPU/RAM via health, suhu & optik via sensors, trafik via port rate).
//   Deret grafik dibangun bergulir di server dari nilai tiap sinkronisasi —
//   riwayat penuh (RRD) menyusul lewat proxy graph PNG pada Fase 7.
// - FIXTURE (default development): generator deterministik berlabel.

import {
  advancePortBandwidth,
  advanceTemperature,
  advanceUsageSeries,
  generateOpticalHealth,
  type PonPortHealth,
  type PortBandwidth,
  type PortBandwidthPoint,
  type TemperatureReading,
  type UsagePoint,
} from "@/lib/mock-metrics";
import { cache } from "@/server/cache";
import { getAssetsWithStatus } from "@/server/device-store";
import {
  dbmSensorsToOptics,
  fetchDeviceCpuUsage,
  fetchDeviceHealth,
  fetchDeviceMemUsage,
  fetchDevicePorts,
  isLibrenmsConfigured,
  portToRate,
  sensorsToTemperature,
  type LibrenmsSensor,
} from "@/server/librenms";
import type { DeviceGroup } from "@/types/device";

const METRICS_TTL_SECONDS = 10;
const SERIES_MAX_POINTS = 30;

export interface DeviceMetricsSnapshot {
  usage: UsagePoint[];
  temperature: TemperatureReading | null;
  ports: PortBandwidth[];
  updatedAt: string;
}

const timeLabel = () =>
  new Date().toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });

// ---------------------------------------------------------------------------
// Mode TERHUBUNG — deret bergulir per perangkat dari nilai live.
// ---------------------------------------------------------------------------

const liveUsageSeries = new Map<string, UsagePoint[]>();
const livePortSeries = new Map<string, Map<string, PortBandwidthPoint[]>>();

async function resolveLibrenmsDeviceId(
  assetId: string,
): Promise<number | null> {
  const { assets } = await getAssetsWithStatus();
  return (
    assets.find((asset) => asset.assetId === assetId)?.librenmsDeviceId ?? null
  );
}

/**
 * Sensor/health device — satu panggilan `/devices/{id}/health` per TTL.
 * Bila suatu instalasi tidak punya sensor, hasil kosong (bukan error).
 */
async function getDeviceSensors(
  librenmsDeviceId: number,
): Promise<LibrenmsSensor[]> {
  const key = `librenms:health:${librenmsDeviceId}`;
  const cached = await cache.get<LibrenmsSensor[]>(key);
  if (cached) return cached;
  const sensors = await fetchDeviceHealth(librenmsDeviceId);
  await cache.set(key, sensors, METRICS_TTL_SECONDS);
  return sensors;
}

async function buildLibrenmsMetrics(
  assetId: string,
  librenmsDeviceId: number,
): Promise<DeviceMetricsSnapshot> {
  const [ports, sensors, cpu, ram] = await Promise.all([
    fetchDevicePorts(librenmsDeviceId),
    getDeviceSensors(librenmsDeviceId),
    fetchDeviceCpuUsage(librenmsDeviceId),
    fetchDeviceMemUsage(librenmsDeviceId),
  ]);
  const now = timeLabel();

  let usage = liveUsageSeries.get(assetId) ?? [];
  if (cpu !== null || ram !== null) {
    // Nilai yang tidak terbaca disimpan apa adanya sebagai `null`, bukan 0.
    // Perangkat yang melaporkan CPU tapi tidak memori akan menggambar garis
    // RAM yang putus — bukan garis datar 0% yang terbaca sebagai "hemat".
    usage = [
      ...usage.slice(-(SERIES_MAX_POINTS - 1)),
      { time: now, cpu, ram },
    ];
    liveUsageSeries.set(assetId, usage);
  }

  const portSeries =
    livePortSeries.get(assetId) ?? new Map<string, PortBandwidthPoint[]>();
  const portBandwidth: PortBandwidth[] = ports.map((port) => {
    const rate = portToRate(port);
    const prev = portSeries.get(rate.port) ?? [];
    const series = [
      ...prev.slice(-(SERIES_MAX_POINTS - 1)),
      { time: now, download: rate.downloadMbps, upload: rate.uploadMbps },
    ];
    portSeries.set(rate.port, series);
    return {
      port: rate.port,
      series,
      currentDownload: rate.downloadMbps,
      currentUpload: rate.uploadMbps,
    };
  });
  livePortSeries.set(assetId, portSeries);

  return {
    usage,
    // `null`, bukan 0 °C "normal". Perangkat tanpa sensor suhu — dan banyak
    // switch akses memang tidak punya — akan ditampilkan seolah terukur 0
    // derajat dan sehat. Itu bukan pembacaan yang meleset, itu pembacaan yang
    // tidak pernah ada. Aturan yang sama dengan CPU/RAM dan jeda trafik.
    temperature: sensorsToTemperature(sensors),
    ports: portBandwidth,
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// API publik store
// ---------------------------------------------------------------------------

export async function getDeviceMetrics(
  deviceId: string,
  group: DeviceGroup,
): Promise<DeviceMetricsSnapshot> {
  const key = `device-metrics:${deviceId}`;
  const cached = await cache.get<DeviceMetricsSnapshot>(key);
  if (cached) return cached;

  let snapshot: DeviceMetricsSnapshot | null = null;
  if (isLibrenmsConfigured()) {
    const librenmsDeviceId = await resolveLibrenmsDeviceId(deviceId);
    if (librenmsDeviceId !== null) {
      snapshot = await buildLibrenmsMetrics(deviceId, librenmsDeviceId);
    }
  }
  if (!snapshot) {
    // DEVELOPMENT FIXTURE — juga dipakai bila aset belum dipetakan ke LibreNMS.
    snapshot = {
      usage: advanceUsageSeries(deviceId),
      temperature: advanceTemperature(deviceId),
      ports: advancePortBandwidth(deviceId, group),
      updatedAt: new Date().toISOString(),
    };
  }

  await cache.set(key, snapshot, METRICS_TTL_SECONDS);
  return snapshot;
}

export interface OltOpticsSnapshot {
  ports: PonPortHealth[];
  updatedAt: string;
}

/**
 * Grid kesehatan optik OLT ber-cache. Mode terhubung memetakan sensor kelas
 * `dbm`; daftar ONU per port memerlukan integrasi vendor OLT sehingga
 * kosong dulu. Mode fixture memakai generator berlabel.
 */
export async function getOltOptics(deviceId: string): Promise<OltOpticsSnapshot> {
  const key = `olt-optics:${deviceId}`;
  const cached = await cache.get<OltOpticsSnapshot>(key);
  if (cached) return cached;

  let ports: PonPortHealth[] | null = null;
  if (isLibrenmsConfigured()) {
    const librenmsDeviceId = await resolveLibrenmsDeviceId(deviceId);
    if (librenmsDeviceId !== null) {
      const sensors = await getDeviceSensors(librenmsDeviceId);
      ports = dbmSensorsToOptics(sensors);
    }
  }

  const snapshot: OltOpticsSnapshot = {
    ports: ports ?? generateOpticalHealth(deviceId),
    updatedAt: new Date().toISOString(),
  };
  await cache.set(key, snapshot, METRICS_TTL_SECONDS);
  return snapshot;
}
