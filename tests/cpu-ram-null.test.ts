// CPU dan RAM yang tidak terbaca disimpan sebagai `null`, bukan 0.
//
// Sampai 22 Agustus 2026 `metrics-store.ts` menulis `cpu ?? 0, ram ?? 0`.
// Perangkat yang melaporkan CPU tapi tidak memori — dan LibreNMS memang
// begitu untuk sebagian perangkat — menggambar garis RAM datar di 0%.
//
// Garis datar 0% terbaca sebagai "perangkat ini nyaris tidak memakai memori".
// Yang sebenarnya terjadi: sensornya tidak menjawab. Keduanya terlihat persis
// sama, dan yang pertama menenangkan — jenis kesalahan yang sama dengan
// `averageUptime: 0` pada laporan SLA dan jeda trafik yang digambar nol.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sensors: [] as unknown[],
  cpu: null as number | null,
  ram: null as number | null,
}));

// Cache dilumpuhkan: yang diuji adalah bentuk snapshot yang dibangun, bukan
// perilaku cache-nya.
vi.mock("@/server/cache", () => ({
  cache: { get: async () => null, set: async () => {}, del: async () => {} },
}));
vi.mock("@/server/device-store", () => ({
  getAssetsWithStatus: async () => ({
    assets: [{ assetId: "sw-akses", librenmsDeviceId: 7 }],
  }),
}));
vi.mock("@/server/librenms", async (asli) => ({
  ...(await asli<typeof import("@/server/librenms")>()),
  isLibrenmsConfigured: () => true,
  fetchDevicePorts: async () => [],
  fetchDeviceHealth: async () => mocks.sensors,
  fetchDeviceCpuUsage: async () => mocks.cpu,
  fetchDeviceMemUsage: async () => mocks.ram,
}));
import { advanceUsageSeries, generateUsageSeries, type UsagePoint } from "@/lib/mock-metrics";
import { sensorsToTemperature, type LibrenmsSensor } from "@/server/librenms";
import {
  getDeviceMetrics,
  type DeviceMetricsSnapshot,
} from "@/server/metrics-store";

describe("UsagePoint membolehkan tidak-terbaca", () => {
  it("cpu dan ram menerima null tanpa memaksa jadi angka", () => {
    // Penjaga tipe: kalau kolomnya dikembalikan jadi `number`, baris ini
    // gagal dikompilasi dan tesnya ikut merah.
    const titik: UsagePoint = { time: "10:00", cpu: null, ram: null };
    expect(titik.cpu).toBeNull();
    expect(titik.ram).toBeNull();
  });

  it("null dan 0 adalah dua hal berbeda", () => {
    const takTerbaca: UsagePoint = { time: "10:00", cpu: null, ram: 40 };
    const benarNol: UsagePoint = { time: "10:01", cpu: 0, ram: 40 };
    expect(takTerbaca.cpu).not.toBe(benarNol.cpu);
    // Sebuah perangkat yang benar-benar diam MEMANG boleh melaporkan 0%.
    expect(benarNol.cpu).toBe(0);
  });
});

describe("deret tiruan tetap berisi angka", () => {
  it("generateUsageSeries tidak pernah memuat null", () => {
    const deret = generateUsageSeries("uji");
    expect(deret.length).toBeGreaterThan(0);
    expect(deret.every((p) => typeof p.cpu === "number" && typeof p.ram === "number")).toBe(true);
  });

  it("advanceUsageSeries tetap jalan walau titik terakhir null", () => {
    // Cadangan di dalamnya hanya memenuhi tipe; ia tidak boleh melempar.
    const deret = advanceUsageSeries("uji-lanjut");
    expect(deret.at(-1)!.cpu).not.toBeNull();
    expect(Number.isFinite(deret.at(-1)!.cpu as number)).toBe(true);
  });
});

describe("suhu perangkat tanpa sensor", () => {
  beforeEach(() => {
    mocks.sensors = [];
    mocks.cpu = null;
    mocks.ram = null;
  });


  it("sensorsToTemperature mengembalikan null, dan itu yang harus dipakai", () => {
    // Sampai 22 Agustus 2026 `metrics-store.ts` menutup null ini dengan
    // `?? { celsius: 0, status: "normal" }`. Perangkat tanpa sensor suhu —
    // dan banyak switch akses memang tidak punya — tampil sebagai 0 °C
    // berlencana hijau "Normal". Itu bukan pembacaan yang meleset; itu
    // pembacaan yang tidak pernah ada, ditampilkan sebagai kabar baik.
    expect(sensorsToTemperature([])).toBeNull();
    expect(
      sensorsToTemperature([
        { sensor_class: "dbm", sensor_current: -21 } as LibrenmsSensor,
      ]),
    ).toBeNull();
    // Yang punya sensor tetap terbaca, dan yang terpanas yang menang.
    expect(
      sensorsToTemperature([
        { sensor_class: "temperature", sensor_current: 31 },
        { sensor_class: "temperature", sensor_current: 57 },
      ] as LibrenmsSensor[]),
    ).toEqual({ celsius: 57, status: expect.any(String) });
  });

  it("perangkat tanpa sensor suhu TIDAK dilaporkan 0 °C Normal", async () => {
    // Ini yang benar-benar dijalankan — penjaga tipe di bawah hanya gagal saat
    // `tsc`, dan repo ini tidak punya CI yang menjalankannya sendiri.
    mocks.sensors = [];
    mocks.cpu = 12;
    const snapshot = await getDeviceMetrics("sw-akses", "Ruijie");
    expect(snapshot.temperature).toBeNull();
  });

  it("perangkat yang PUNYA sensor tetap melaporkan suhunya", async () => {
    mocks.sensors = [{ sensor_class: "temperature", sensor_current: 44 }];
    const snapshot = await getDeviceMetrics("sw-akses", "Ruijie");
    expect(snapshot.temperature?.celsius).toBe(44);
  });

  it("DeviceMetricsSnapshot.temperature boleh null", () => {
    // Penjaga tipe, seperti UsagePoint di atas: kalau field-nya dikembalikan
    // jadi wajib, baris ini gagal dikompilasi.
    const suhu: DeviceMetricsSnapshot["temperature"] = null;
    expect(suhu).toBeNull();
  });
});
