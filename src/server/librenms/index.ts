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
 * DAFTAR KELAS health yang dipunyai satu device — bukan pembacaannya.
 *
 * `/devices/{id}/health` mengembalikan katalog: `[{desc: "Temperature", name:
 * "device_temperature"}, …]`. Tidak ada `sensor_class` maupun
 * `sensor_current` di dalamnya.
 *
 * Sampai 22 Agustus 2026 hasil endpoint ini diperlakukan sebagai
 * `LibrenmsSensor[]` dan diserahkan ke `sensorsToTemperature()` yang menyaring
 * `sensor_class === "temperature"`. Penyaring itu tidak pernah cocok sekali
 * pun, jadi suhu SELALU null — dan di layar tertutup `?? { celsius: 0,
 * status: "normal" }`, yaitu 0 °C berlencana hijau untuk setiap perangkat.
 * Kesalahannya tidak pernah terlihat karena bentuk keluarannya tetap sah.
 *
 * Untuk pembacaan sungguhan pakai `fetchHealthSensors()` di bawah.
 */
export async function fetchDeviceHealthClasses(
  deviceId: number,
): Promise<Array<{ name: string; desc: string }>> {
  const body = await librenmsFetch<{ graphs?: Array<{ name: string; desc: string }> }>(
    `/devices/${deviceId}/health`,
  );
  return body.graphs ?? [];
}

/**
 * Pembacaan sensor sungguhan untuk satu kelas health.
 *
 * LibreNMS mengharuskan dua langkah: `/health/{kelas}` memberi daftar
 * `sensor_id`, lalu `/health/{kelas}/{sensor_id}` memberi barisnya lengkap
 * dengan `sensor_class` dan `sensor_current`. Langkah kedua inilah yang
 * selama ini tidak pernah dijalankan untuk suhu dan dbm.
 *
 * `maksSensor` membatasi jumlah permintaan susulan: satu router bisa punya
 * 8 sensor suhu dan sebuah OLT jauh lebih banyak sensor dbm.
 */
export async function fetchHealthSensors(
  deviceId: number,
  kelas: string,
  maksSensor = 16,
): Promise<LibrenmsSensor[]> {
  const list = await librenmsFetch<{ graphs?: HealthListEntry[] }>(
    `/devices/${deviceId}/health/${kelas}`,
  );
  const entries = (list.graphs ?? []).slice(0, maksSensor);
  if (entries.length === 0) return [];

  const baris = await Promise.all(
    entries.map(async (entry) => {
      try {
        const body = await librenmsFetch<{ graphs?: LibrenmsSensor[] }>(
          `/devices/${deviceId}/health/${kelas}/${entry.sensor_id}`,
        );
        return body.graphs?.[0] ?? null;
      } catch {
        // Satu sensor yang gagal tidak boleh menghapus pembacaan lainnya.
        return null;
      }
    }),
  );
  return baris.filter((b): b is LibrenmsSensor => b !== null);
}

interface HealthListEntry {
  sensor_id: number | string;
  desc: string;
}

/**
 * Baris pembacaan untuk kelas processor/mempool.
 *
 * **Nama fieldnya BUKAN `sensor_current`.** Processor dan mempool disimpan
 * LibreNMS di tabelnya sendiri, bukan di tabel `sensors`, dan memakai nama
 * kolomnya sendiri:
 *
 * - `device_processor` → `processor_usage` (persen)
 * - `device_mempool`   → `mempool_perc` (persen)
 *
 * Sampai 22 Agustus 2026 kode ini membaca `sensor_current` untuk keduanya.
 * Field itu tidak ada di sana, jadi CPU dan RAM SELALU null sejak LibreNMS
 * tersambung — grafiknya kosong, dan tidak ada yang melapor karena kosong
 * terlihat seperti "belum ada trafik".
 */
interface HealthSensorRecord {
  sensor_id?: number | string;
  sensor_current?: number | string | null;
  processor_usage?: number | string | null;
  mempool_perc?: number | string | null;
}

const FIELD_NILAI = {
  device_processor: "processor_usage",
  device_mempool: "mempool_perc",
} as const;

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
      const record = body.graphs?.[0];
      // Field khusus kelasnya dulu; `sensor_current` disisakan sebagai
      // cadangan kalau kelak ada versi LibreNMS yang memakainya.
      const current = record?.[FIELD_NILAI[type]] ?? record?.sensor_current;
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
