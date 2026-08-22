// DEVELOPMENT FIXTURE — generator metrik tiruan deterministik per perangkat.
// Diganti data riil dari adapter LibreNMS pada Fase 3.

import type { DeviceGroup } from "@/types/device";

export interface UsagePoint {
  time: string;
  /**
   * Persen pemakaian, atau `null` kalau tidak terbaca.
   *
   * BUKAN 0. Sampai 22 Agustus 2026 nilai yang tidak terbaca disimpan sebagai
   * `0`, dan garis datar 0% pada grafik terbaca sebagai "perangkat ini nyaris
   * tidak memakai memori" — bukan "sensornya tidak menjawab". Keduanya
   * terlihat persis sama, dan yang pertama menenangkan.
   *
   * Sebagian perangkat memang hanya melaporkan salah satu: LibreNMS bisa
   * memberi CPU tanpa memori, dan sebaliknya.
   */
  cpu: number | null;
  ram: number | null;
}

// mulberry32 — PRNG kecil deterministik dari seed numerik
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(i)) | 0;
  }
  return hash;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export type TemperatureStatus = "normal" | "tinggi" | "kritis";

export interface TemperatureReading {
  celsius: number;
  status: TemperatureStatus;
}

// Ambang suhu perangkat jaringan (°C)
export const TEMP_THRESHOLD_HIGH = 60;
export const TEMP_THRESHOLD_CRITICAL = 75;

/** Suhu perangkat tiruan yang deterministik per perangkat. */
export function generateTemperature(deviceId: string): TemperatureReading {
  const rand = mulberry32(hashSeed(`temp:${deviceId}`));
  const celsius = Math.round(38 + rand() * 45);
  const status: TemperatureStatus =
    celsius >= TEMP_THRESHOLD_CRITICAL
      ? "kritis"
      : celsius >= TEMP_THRESHOLD_HIGH
        ? "tinggi"
        : "normal";
  return { celsius, status };
}

export interface PortBandwidthPoint {
  time: string;
  download: number;
  upload: number;
}

export interface PortBandwidth {
  port: string;
  series: PortBandwidthPoint[];
  currentDownload: number;
  currentUpload: number;
}

const PORT_NAMES: Record<DeviceGroup, string[]> = {
  MikroTik: ["ether1", "ether2", "ether3", "sfp-sfpplus1"],
  Ruijie: ["Gi0/1", "Gi0/2", "Gi0/3", "Te0/25"],
  OLT: ["gpon-olt_1/1", "gpon-olt_1/2", "gpon-olt_1/3", "xge-uplink_1/1"],
};

/** Trafik download/upload (Mbps) per port sebagai random-walk halus. */
export function generatePortBandwidth(
  deviceId: string,
  group: DeviceGroup,
  points = 20,
): PortBandwidth[] {
  const now = Date.now();
  return PORT_NAMES[group].map((port) => {
    const rand = mulberry32(hashSeed(`bw:${deviceId}:${port}`));
    let download = 100 + rand() * 600;
    let upload = 30 + rand() * 200;
    const series: PortBandwidthPoint[] = [];
    for (let i = points - 1; i >= 0; i--) {
      download = clamp(download + (rand() - 0.5) * 120, 5, 950);
      upload = clamp(upload + (rand() - 0.5) * 50, 2, 400);
      const stamp = new Date(now - i * 60_000);
      series.push({
        time: stamp.toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        download: Math.round(download),
        upload: Math.round(upload),
      });
    }
    const last = series[series.length - 1];
    return {
      port,
      series,
      currentDownload: last.download,
      currentUpload: last.upload,
    };
  });
}

// ---------------------------------------------------------------------------
// State polling: deret metrik "maju" satu titik tiap penarikan, meniru data
// live LibreNMS. Init deterministik per perangkat, langkah berikutnya acak halus.
// ---------------------------------------------------------------------------

const timeLabel = () =>
  new Date().toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });

const usageStates = new Map<string, UsagePoint[]>();

export function advanceUsageSeries(deviceId: string): UsagePoint[] {
  const prev = usageStates.get(deviceId) ?? generateUsageSeries(deviceId);
  const last = prev[prev.length - 1];
  // Deret tiruan tidak pernah memuat `null` — ia dibangkitkan sendiri di
  // berkas ini. Cadangan di bawah hanya memenuhi tipe yang kini membolehkan
  // `null` untuk nilai NYATA yang tidak terbaca.
  const cpuLalu = last.cpu ?? 50;
  const ramLalu = last.ram ?? 50;
  const next: UsagePoint = {
    time: timeLabel(),
    cpu: Math.round(clamp(cpuLalu + (Math.random() - 0.5) * 12, 3, 98)),
    ram: Math.round(clamp(ramLalu + (Math.random() - 0.5) * 6, 10, 95)),
  };
  const series = [...prev.slice(1), next];
  usageStates.set(deviceId, series);
  return series;
}

const tempStates = new Map<string, TemperatureReading>();

export function advanceTemperature(deviceId: string): TemperatureReading {
  const prev = tempStates.get(deviceId) ?? generateTemperature(deviceId);
  const celsius = Math.round(
    clamp(prev.celsius + (Math.random() - 0.5) * 3, 35, 88),
  );
  const status: TemperatureStatus =
    celsius >= TEMP_THRESHOLD_CRITICAL
      ? "kritis"
      : celsius >= TEMP_THRESHOLD_HIGH
        ? "tinggi"
        : "normal";
  const reading = { celsius, status };
  tempStates.set(deviceId, reading);
  return reading;
}

const portStates = new Map<string, PortBandwidth[]>();

export function advancePortBandwidth(
  deviceId: string,
  group: DeviceGroup,
): PortBandwidth[] {
  const prev =
    portStates.get(deviceId) ?? generatePortBandwidth(deviceId, group);
  const advanced = prev.map((port) => {
    const last = port.series[port.series.length - 1];
    const next: PortBandwidthPoint = {
      time: timeLabel(),
      download: Math.round(
        clamp(last.download + (Math.random() - 0.5) * 120, 5, 950),
      ),
      upload: Math.round(
        clamp(last.upload + (Math.random() - 0.5) * 50, 2, 400),
      ),
    };
    const series = [...port.series.slice(1), next];
    return {
      ...port,
      series,
      currentDownload: next.download,
      currentUpload: next.upload,
    };
  });
  portStates.set(deviceId, advanced);
  return advanced;
}

export type HistoryMetric = "cpu" | "ram" | "suhu" | "bandwidth";

export interface HistoryPoint {
  time: string;
  value: number;
}

const HISTORY_RANGE: Record<
  HistoryMetric,
  { min: number; max: number; step: number }
> = {
  cpu: { min: 3, max: 98, step: 10 },
  ram: { min: 10, max: 95, step: 5 },
  suhu: { min: 38, max: 85, step: 3 },
  bandwidth: { min: 5, max: 950, step: 90 },
};

/**
 * Deret riwayat satu metrik sebagai random-walk halus.
 * `hours` menentukan rentang mundur dari sekarang; jumlah titik dibuat tetap
 * (interval menyesuaikan) agar chart tidak kelebihan beban.
 */
export function generateHistorySeries(
  deviceId: string,
  metric: HistoryMetric,
  hours: number,
  points = 96,
): HistoryPoint[] {
  const { min, max, step } = HISTORY_RANGE[metric];
  const rand = mulberry32(hashSeed(`history:${deviceId}:${metric}:${hours}`));
  let value = min + rand() * (max - min);
  const now = Date.now();
  const intervalMs = (hours * 3_600_000) / points;
  const series: HistoryPoint[] = [];

  for (let i = points - 1; i >= 0; i--) {
    value = clamp(value + (rand() - 0.5) * step * 2, min, max);
    const stamp = new Date(now - i * intervalMs);
    series.push({
      time:
        hours <= 24
          ? stamp.toLocaleTimeString("id-ID", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : stamp.toLocaleDateString("id-ID", {
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            }),
      value: Math.round(value * 10) / 10,
    });
  }
  return series;
}

export type OnuStatus = "online" | "offline" | "dying_gasp";

export interface OnuInfo {
  id: string;
  /** Daya terima optik di sisi ONU (dBm) — makin negatif makin lemah. */
  rxPower: number;
  status: OnuStatus;
}

export interface PonPortHealth {
  port: string;
  sfpUp: boolean;
  /** Daya pancar SFP PON (dBm). */
  txPower: number;
  onus: OnuInfo[];
}

// Ambang Rx Power ONU (dBm) — di bawah "low" berarti redaman tinggi.
export const RX_POWER_LOW = -25;
export const RX_POWER_CRITICAL = -28;

/** Kesehatan optik OLT tiruan: SFP PON, Tx Power, dan daftar ONU per port. */
export function generateOpticalHealth(deviceId: string): PonPortHealth[] {
  return ["gpon-olt_1/1", "gpon-olt_1/2", "gpon-olt_1/3", "gpon-olt_1/4"].map(
    (port) => {
      const rand = mulberry32(hashSeed(`optic:${deviceId}:${port}`));
      const sfpUp = rand() > 0.08;
      const txPower = Math.round((2 + rand() * 3) * 10) / 10;
      const onuCount = 4 + Math.floor(rand() * 3);
      const onus: OnuInfo[] = Array.from({ length: onuCount }, (_, i) => {
        const rxPower = Math.round((-15 - rand() * 15) * 10) / 10;
        let status: OnuStatus = "online";
        if (!sfpUp) {
          status = "offline";
        } else if (rxPower < RX_POWER_CRITICAL) {
          status = rand() > 0.5 ? "dying_gasp" : "offline";
        } else if (rand() < 0.08) {
          status = "dying_gasp";
        }
        return {
          id: `ONU-${port.slice(-3)}-${String(i + 1).padStart(2, "0")}`,
          rxPower,
          status,
        };
      });
      return { port, sfpUp, txPower, onus };
    },
  );
}

/**
 * Deret pemakaian CPU & RAM (persen) sebagai random-walk halus,
 * satu titik per menit mundur dari sekarang.
 */
export function generateUsageSeries(
  deviceId: string,
  points = 30,
): UsagePoint[] {
  const rand = mulberry32(hashSeed(deviceId));
  const series: UsagePoint[] = [];
  let cpu = 20 + rand() * 50;
  let ram = 30 + rand() * 40;
  const now = Date.now();

  for (let i = points - 1; i >= 0; i--) {
    cpu = clamp(cpu + (rand() - 0.5) * 12, 3, 98);
    ram = clamp(ram + (rand() - 0.5) * 6, 10, 95);
    const stamp = new Date(now - i * 60_000);
    series.push({
      time: stamp.toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      cpu: Math.round(cpu),
      ram: Math.round(ram),
    });
  }
  return series;
}
