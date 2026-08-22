// Pemetaan murni payload LibreNMS → domain Portal. Tanpa I/O agar mudah
// diuji; pemanggilan HTTP ada di ./index.ts, caching di store.

import {
  TEMP_THRESHOLD_CRITICAL,
  TEMP_THRESHOLD_HIGH,
  type PonPortHealth,
  type TemperatureReading,
  type TemperatureStatus,
} from "@/lib/mock-metrics";
import type { Asset } from "@/types/asset";
import type { DeviceStatus } from "@/types/device";
import type {
  LibrenmsAlertRow,
  LibrenmsAvailability,
  LibrenmsDevice,
  LibrenmsLink,
  LibrenmsPort,
  LibrenmsSensor,
} from "@/server/librenms/types";

/**
 * Status Portal dari status LibreNMS:
 * down/disabled → offline; up dengan alert aktif → warning; up bersih → online.
 */
export function statusFromDevice(
  device: Pick<LibrenmsDevice, "status" | "disabled">,
  hasActiveAlert: boolean,
): DeviceStatus {
  if (device.disabled === 1 || device.status === 0) return "offline";
  return hasActiveAlert ? "warning" : "online";
}

/**
 * Perkaya Asset Portal dengan metadata LibreNMS. Identitas operasional
 * (displayName, site, networkRole, koordinat yang sudah diisi operator)
 * tetap milik Portal; LibreNMS hanya mengisi kolom yang masih kosong.
 */
export function enrichAssetFromDevice(
  asset: Asset,
  device: LibrenmsDevice,
): Asset {
  return {
    ...asset,
    os: asset.os ?? device.os,
    model: asset.model ?? device.hardware,
    serialNumber: asset.serialNumber ?? device.serial,
    location: asset.location ?? device.location,
    latitude: asset.latitude ?? device.lat,
    longitude: asset.longitude ?? device.lng,
  };
}

/** Rate oktet/detik (LibreNMS `if*Octets_rate`) → Mbps, 1 desimal. */
export function octetsRateToMbps(rate: number | null | undefined): number {
  if (rate == null || !Number.isFinite(rate) || rate < 0) return 0;
  return Math.round((rate * 8) / 100_000) / 10;
}

export interface PortRate {
  port: string;
  operUp: boolean;
  downloadMbps: number;
  uploadMbps: number;
}

/** Nama port terbaik + rate saat ini. In = download (arah pelanggan). */
export function portToRate(port: LibrenmsPort): PortRate {
  return {
    port: port.ifName || port.ifDescr || `port-${port.port_id}`,
    operUp: port.ifOperStatus === "up",
    downloadMbps: octetsRateToMbps(port.ifInOctets_rate),
    uploadMbps: octetsRateToMbps(port.ifOutOctets_rate),
  };
}

function temperatureStatusOf(celsius: number): TemperatureStatus {
  if (celsius >= TEMP_THRESHOLD_CRITICAL) return "kritis";
  if (celsius >= TEMP_THRESHOLD_HIGH) return "tinggi";
  return "normal";
}

/** Suhu terpanas dari sensor kelas `temperature`; null bila tidak ada. */
export function sensorsToTemperature(
  sensors: LibrenmsSensor[],
): TemperatureReading | null {
  const values = sensors
    .filter(
      (sensor) =>
        sensor.sensor_class === "temperature" && sensor.sensor_current != null,
    )
    .map((sensor) => Number(sensor.sensor_current));
  if (values.length === 0) return null;
  const celsius = Math.round(Math.max(...values));
  return { celsius, status: temperatureStatusOf(celsius) };
}

/**
 * Sensor optik (kelas `dbm`) → grid kesehatan optik per port.
 * Daftar ONU per port tidak tersedia dari sensor generik — perlu integrasi
 * OLT spesifik vendor (dicatat sebagai keterbatasan; menyusul).
 */
export function dbmSensorsToOptics(sensors: LibrenmsSensor[]): PonPortHealth[] {
  return sensors
    .filter((sensor) => sensor.sensor_class === "dbm")
    .map((sensor) => ({
      port: sensor.sensor_descr,
      sfpUp: sensor.sensor_current != null,
      // `null`, bukan 0 — lihat alasannya di `PonPortHealth.txPower`.
      txPower:
        sensor.sensor_current == null
          ? null
          : Math.round(Number(sensor.sensor_current) * 10) / 10,
      onus: [],
    }));
}

/** Persentase availability untuk jendela `duration` detik; null bila absen. */
export function availabilityPercent(
  rows: LibrenmsAvailability[],
  durationSeconds: number,
): number | null {
  const row = rows.find((item) => Number(item.duration) === durationSeconds);
  if (!row) return null;
  const value = Number(row.availability_perc);
  return Number.isFinite(value) ? value : null;
}

export interface ActiveAlert {
  alertId: string;
  librenmsDeviceId: number;
  severity: "warning" | "critical";
  acknowledged: boolean;
  timestamp: string;
}

/** Baris /alerts → alert aktif Portal; state 0 (cleared) & severity ok dibuang. */
export function normalizeActiveAlert(row: LibrenmsAlertRow): ActiveAlert | null {
  if (row.state === 0 || row.severity === "ok") return null;
  return {
    alertId: String(row.id),
    librenmsDeviceId: row.device_id,
    severity: row.severity,
    acknowledged: row.state === 2,
    timestamp: row.timestamp,
  };
}

export interface DiscoveredLink {
  localDeviceId: number;
  remoteDeviceId: number;
  protocol: string;
  localPortId: number | null;
  remotePort: string | null;
  remoteHostname: string | null;
}

/**
 * Baris /devices/{id}/links → kandidat link topologi (bahan REKOMENDASI
 * discovery Fase 5 — tidak pernah menimpa topologi manual). Link non-aktif
 * atau yang remote-nya tidak dikenal LibreNMS dibuang.
 */
export function normalizeDiscoveredLink(
  link: LibrenmsLink,
): DiscoveredLink | null {
  if (link.active !== 1 || link.remote_device_id == null) return null;
  if (link.remote_device_id === 0) return null;
  return {
    localDeviceId: link.local_device_id,
    remoteDeviceId: link.remote_device_id,
    protocol: (link.protocol ?? "unknown").toLowerCase(),
    localPortId: link.local_port_id,
    remotePort: link.remote_port,
    remoteHostname: link.remote_hostname,
  };
}
