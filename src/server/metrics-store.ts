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
  fetchHealthSensors,
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
 * Pembacaan sensor satu KELAS health, ber-cache per (device, kelas).
 *
 * Dulu ini memanggil `/devices/{id}/health` sekali dan menganggap hasilnya
 * daftar sensor. Bukan: itu katalog nama kelas, tanpa `sensor_class` maupun
 * `sensor_current`. Akibatnya suhu dan optik tidak pernah terbaca sekali pun.
 * Sekarang kelasnya disebut eksplisit dan pembacaannya diambil per sensor.
 *
 * Bila suatu instalasi tidak punya sensor kelas itu, hasil kosong (bukan
 * error) — banyak switch akses memang tidak punya sensor suhu.
 */
async function getHealthSensors(
  librenmsDeviceId: number,
  kelas: "device_temperature" | "device_dbm",
): Promise<LibrenmsSensor[]> {
  const key = `librenms:health:${kelas}:${librenmsDeviceId}`;
  const cached = await cache.get<LibrenmsSensor[]>(key);
  if (cached) return cached;
  const sensors = await fetchHealthSensors(librenmsDeviceId, kelas);
  await cache.set(key, sensors, METRICS_TTL_SECONDS);
  return sensors;
}

async function buildLibrenmsMetrics(
  assetId: string,
  librenmsDeviceId: number,
): Promise<DeviceMetricsSnapshot> {
  const [ports, sensors, cpu, ram] = await Promise.all([
    fetchDevicePorts(librenmsDeviceId),
    getHealthSensors(librenmsDeviceId, "device_temperature"),
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
  /**
   * Dari mana angka ini berasal. Aturan yang sama dengan riwayat metrik dan
   * laporan SLA: yang belum punya sumber MENGAKU belum punya, tidak diganti
   * angka yang terlihat masuk akal.
   */
  sumber: "terukur" | "fixture" | "belum-ada-data";
  /** Kalimat penjelas siap tampil; terisi hanya saat `belum-ada-data`. */
  catatan?: string;
  updatedAt: string;
}

/**
 * Grid kesehatan optik OLT ber-cache. Mode terhubung memetakan sensor kelas
 * `dbm`; daftar ONU per port memerlukan integrasi vendor OLT sehingga
 * kosong dulu.
 *
 * **OLT yang tidak terpetakan ke LibreNMS tidak lagi diisi deret tiruan.**
 * Sampai 22 Agustus 2026 cabang itu jatuh ke `generateOpticalHealth()` dan
 * `HSGQ-100-Kecicang` menampilkan 4 port PON dengan daya pancar karangan
 * (+3,7 dBm dan seterusnya), tanpa apa pun di payload yang mengatakannya.
 * Perangkat itu justru yang diputuskan dibaca lewat konsol CLI dan memang
 * tidak akan pernah punya data LibreNMS — jadi karangannya permanen.
 *
 * Deret tiruan sekarang hanya keluar saat LibreNMS memang belum
 * dikonfigurasi (pengembangan), dan ia mengaku `fixture`.
 */
export async function getOltOptics(deviceId: string): Promise<OltOpticsSnapshot> {
  const key = `olt-optics:${deviceId}`;
  const cached = await cache.get<OltOpticsSnapshot>(key);
  if (cached) return cached;

  const snapshot = await bangunOptik(deviceId);
  await cache.set(key, snapshot, METRICS_TTL_SECONDS);
  return snapshot;
}

async function bangunOptik(deviceId: string): Promise<OltOpticsSnapshot> {
  const updatedAt = new Date().toISOString();

  if (!isLibrenmsConfigured()) {
    return {
      ports: generateOpticalHealth(deviceId),
      sumber: "fixture",
      updatedAt,
    };
  }

  const librenmsDeviceId = await resolveLibrenmsDeviceId(deviceId);
  if (librenmsDeviceId === null) {
    return {
      ports: [],
      sumber: "belum-ada-data",
      catatan:
        "Perangkat ini tidak terdaftar di LibreNMS, jadi sensor optiknya tidak terbaca. Sebagian OLT memang dibaca lewat konsol CLI, bukan SNMP.",
      updatedAt,
    };
  }

  const ports = dbmSensorsToOptics(
    await getHealthSensors(librenmsDeviceId, "device_dbm"),
  );
  if (ports.length === 0) {
    return {
      ports: [],
      sumber: "belum-ada-data",
      catatan:
        "LibreNMS belum melaporkan satu pun sensor optik (kelas dbm) untuk perangkat ini.",
      updatedAt,
    };
  }
  return { ports, sumber: "terukur", updatedAt };
}
