// Adapter LibreNMS — satu fungsi per endpoint API v0 yang dipakai Portal.
// Semua panggilan lewat client.ts (token dari env, hanya server). Caching
// TTL dilakukan di store pemakai, bukan di sini.

import { librenmsFetch } from "@/server/librenms/client";
import type {
  LibrenmsAlertRow,
  LibrenmsAvailability,
  LibrenmsDevice,
  LibrenmsEventlogRow,
  LibrenmsLink,
  LibrenmsPort,
  LibrenmsSensor,
} from "@/server/librenms/types";

export { isLibrenmsConfigured, LibrenmsError } from "@/server/librenms/client";
export * from "@/server/librenms/normalize";
export type * from "@/server/librenms/types";

const PORT_COLUMNS = [
  "port_id",
  "device_id",
  "ifName",
  "ifDescr",
  "ifAlias",
  "ifOperStatus",
  "ifAdminStatus",
  "ifSpeed",
  "ifInOctets_rate",
  "ifOutOctets_rate",
].join(",");

/** Seluruh device yang dikenal LibreNMS. */
export async function fetchDevices(): Promise<LibrenmsDevice[]> {
  const body = await librenmsFetch<{ devices?: LibrenmsDevice[] }>(
    "/devices?type=all",
  );
  return body.devices ?? [];
}

export async function fetchDevice(
  deviceId: number,
): Promise<LibrenmsDevice | null> {
  const body = await librenmsFetch<{ devices?: LibrenmsDevice[] }>(
    `/devices/${deviceId}`,
  );
  return body.devices?.[0] ?? null;
}

/** Alert yang sedang aktif (state=1) + yang di-acknowledge (state=2). */
export async function fetchActiveAlerts(): Promise<LibrenmsAlertRow[]> {
  const [active, acked] = await Promise.all([
    librenmsFetch<{ alerts?: LibrenmsAlertRow[] }>("/alerts?state=1"),
    librenmsFetch<{ alerts?: LibrenmsAlertRow[] }>("/alerts?state=2"),
  ]);
  return [...(active.alerts ?? []), ...(acked.alerts ?? [])];
}

export async function fetchDevicePorts(
  deviceId: number,
): Promise<LibrenmsPort[]> {
  const body = await librenmsFetch<{ ports?: LibrenmsPort[] }>(
    `/devices/${deviceId}/ports?columns=${encodeURIComponent(PORT_COLUMNS)}`,
  );
  return body.ports ?? [];
}

/**
 * Sensor/health milik satu device — `/devices/{id}/health` mengembalikan
 * seluruh kelas (temperature, dbm, voltage, …) sekaligus. Endpoint agregat
 * `/resources/sensors` tidak ada pada semua versi LibreNMS, jadi pemanggilan
 * dilakukan per device dan di-cache per device oleh store pemakai.
 */
export async function fetchDeviceHealth(
  deviceId: number,
): Promise<LibrenmsSensor[]> {
  const body = await librenmsFetch<{ graphs?: LibrenmsSensor[] }>(
    `/devices/${deviceId}/health`,
  );
  return body.graphs ?? [];
}

interface HealthListEntry {
  sensor_id: number | string;
  desc: string;
}

interface HealthSensorRecord {
  sensor_id: number | string;
  sensor_current: number | string | null;
}

/**
 * Nilai health kelas `device_processor` / `device_mempool` (persen).
 * LibreNMS mengharuskan dua langkah: daftar sensor lalu nilai per sensor;
 * jumlah sensor dibatasi agar tidak membanjiri API. Hasil = rata-rata.
 */
async function fetchHealthAverage(
  deviceId: number,
  type: "device_processor" | "device_mempool",
  maxSensors = 4,
): Promise<number | null> {
  const list = await librenmsFetch<{ graphs?: HealthListEntry[] }>(
    `/devices/${deviceId}/health/${type}`,
  );
  const entries = (list.graphs ?? []).slice(0, maxSensors);
  if (entries.length === 0) return null;

  const values = await Promise.all(
    entries.map(async (entry) => {
      const body = await librenmsFetch<{ graphs?: HealthSensorRecord[] }>(
        `/devices/${deviceId}/health/${type}/${entry.sensor_id}`,
      );
      const current = body.graphs?.[0]?.sensor_current;
      const value = current == null ? NaN : Number(current);
      return Number.isFinite(value) ? value : null;
    }),
  );
  const usable = values.filter((value): value is number => value !== null);
  if (usable.length === 0) return null;
  return (
    Math.round(
      (usable.reduce((sum, value) => sum + value, 0) / usable.length) * 10,
    ) / 10
  );
}

export function fetchDeviceCpuUsage(deviceId: number): Promise<number | null> {
  return fetchHealthAverage(deviceId, "device_processor");
}

export function fetchDeviceMemUsage(deviceId: number): Promise<number | null> {
  return fetchHealthAverage(deviceId, "device_mempool");
}

/** Jendela availability (1 hari, 7 hari, 30 hari, 365 hari). */
export async function fetchDeviceAvailability(
  deviceId: number,
): Promise<LibrenmsAvailability[]> {
  const body = await librenmsFetch<{ availability?: LibrenmsAvailability[] }>(
    `/devices/${deviceId}/availability`,
  );
  return body.availability ?? [];
}

export interface OutageWindow {
  going_down: number;
  up_again: number | null;
}

export async function fetchDeviceOutages(
  deviceId: number,
): Promise<OutageWindow[]> {
  const body = await librenmsFetch<{ outages?: OutageWindow[] }>(
    `/devices/${deviceId}/outages`,
  );
  return body.outages ?? [];
}

export async function fetchDeviceEventlog(
  deviceId: number,
  limit = 50,
): Promise<LibrenmsEventlogRow[]> {
  const body = await librenmsFetch<{
    logs?: LibrenmsEventlogRow[];
    events?: LibrenmsEventlogRow[];
  }>(`/logs/eventlog/${deviceId}?limit=${limit}`);
  return body.logs ?? body.events ?? [];
}

/** Link hasil discovery LLDP/CDP per device — bahan rekomendasi F5. */
export async function fetchDeviceLinks(
  deviceId: number,
): Promise<LibrenmsLink[]> {
  const body = await librenmsFetch<{ links?: LibrenmsLink[] }>(
    `/devices/${deviceId}/links`,
  );
  return body.links ?? [];
}

export interface GraphPngOptions {
  from?: string;
  to?: string;
  width?: number;
  height?: number;
}

/**
 * Grafik RRD LibreNMS sebagai PNG (mis. `device_processor`, `device_bits`).
 * Dipakai route proxy Portal pada Fase 7 agar token tidak pernah sampai
 * ke browser.
 */
export function fetchDeviceGraphPng(
  deviceId: number,
  type: string,
  options: GraphPngOptions = {},
): Promise<Buffer> {
  const params = new URLSearchParams();
  if (options.from) params.set("from", options.from);
  if (options.to) params.set("to", options.to);
  if (options.width) params.set("width", String(options.width));
  if (options.height) params.set("height", String(options.height));
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return librenmsFetch<Buffer>(
    `/devices/${deviceId}/${encodeURIComponent(type)}${query}`,
    { binary: true },
  );
}
