// Pencuplik CPU/RAM/suhu — yang mengisi `device_metric_samples`.
//
// Yang dijaga di sini:
//   1. Nilai yang tidak terbaca ditulis NULL, bukan 0. Garis datar 0% terbaca
//      sebagai "hemat"; yang benar adalah "tidak terbaca".
//   2. Perangkat yang KETIGA metriknya kosong tidak menulis baris sama sekali.
//   3. Perangkat tanpa padanan LibreNMS (dibaca lewat konsol CLI) dilewati,
//      bukan digagalkan.
//   4. Pemangkas membuang yang lama dan MENYISAKAN yang baru.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  cpu: new Map<number, number | null>(),
  ram: new Map<number, number | null>(),
  sensors: new Map<number, Array<{ sensor_class: string; sensor_current: number | null }>>(),
  terkonfigurasi: true,
  dipanggil: [] as number[],
}));

vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/server/librenms", async (asli) => ({
  ...(await asli<typeof import("@/server/librenms")>()),
  isLibrenmsConfigured: () => mocks.terkonfigurasi,
  fetchDeviceCpuUsage: async (id: number) => {
    mocks.dipanggil.push(id);
    return mocks.cpu.get(id) ?? null;
  },
  fetchDeviceMemUsage: async (id: number) => mocks.ram.get(id) ?? null,
  fetchHealthSensors: async (id: number, kelas: string) =>
    kelas === "device_temperature" ? (mocks.sensors.get(id) ?? []) : [],
}));

import * as schema from "@/db/schema";
import {
  cuplikMetrikPerangkat,
  pangkasCuplikanMetrik,
} from "@/server/device-metrics-poll";

const DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const sqlAll = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(DIR, f), "utf8"))
  .join("\n");

let client: PGlite;
const SEKARANG = new Date("2026-08-22T12:00:00.000Z");

function d() { return mocks.db as ReturnType<typeof drizzle>; }

beforeEach(async () => {
  client = new PGlite();
  await client.exec(sqlAll);
  mocks.db = drizzle(client, { schema });
  mocks.cpu.clear();
  mocks.ram.clear();
  mocks.sensors.clear();
  mocks.terkonfigurasi = true;
  mocks.dipanggil = [];

  await d().insert(schema.assets).values([
    { assetId: "rtr", hostname: "192.168.100.1", displayName: "Router", managementIp: "192.168.100.1", vendor: "MikroTik", site: "Nagabasukih", networkRole: "distribution", librenmsDeviceId: 1 },
    { assetId: "olt", hostname: "192.168.100.60", displayName: "ZTE C600", managementIp: "192.168.100.60", vendor: "ZTE", site: "Kecicang", networkRole: "olt", librenmsDeviceId: 2 },
    // HSGQ-100-Kecicang: tidak mendukung SNMP, dibaca lewat konsol CLI. Tidak
    // punya padanan di LibreNMS, dan itu bukan kegagalan.
    { assetId: "hsgq", hostname: "192.168.100.10", displayName: "HSGQ-100", managementIp: "192.168.100.10", vendor: "HSGQ", site: "Kecicang", networkRole: "olt" },
  ]);
});

afterEach(async () => { await client.close(); });

async function cuplikan() {
  return d().select().from(schema.deviceMetricSamples);
}

describe("cuplikMetrikPerangkat", () => {
  it("menyimpan ketiga metrik saat semuanya terbaca", async () => {
    mocks.cpu.set(1, 42);
    mocks.ram.set(1, 71);
    mocks.sensors.set(1, [{ sensor_class: "temperature", sensor_current: 38 }]);
    const hasil = await cuplikMetrikPerangkat(SEKARANG);
    expect(hasil.dicuplik).toBe(1);
    const [baris] = await cuplikan();
    expect(baris.assetId).toBe("rtr");
    expect(baris.cpuPercent).toBeCloseTo(42, 1);
    expect(baris.ramPercent).toBeCloseTo(71, 1);
    expect(baris.tempCelsius).toBeCloseTo(38, 1);
  });

  it("metrik yang tidak terbaca disimpan NULL, bukan 0", async () => {
    // Perangkat ini melaporkan CPU saja. Kalau RAM dan suhu jadi 0, grafiknya
    // menggambar garis datar 0% yang terbaca sebagai "hemat" — bukan sebagai
    // "tidak terbaca", yang sebenarnya terjadi.
    mocks.cpu.set(1, 42);
    await cuplikMetrikPerangkat(SEKARANG);
    const [baris] = await cuplikan();
    expect(baris.cpuPercent).toBeCloseTo(42, 1);
    expect(baris.ramPercent).toBeNull();
    expect(baris.tempCelsius).toBeNull();
  });

  it("CPU yang tidak terbaca juga NULL, walau RAM terbaca", async () => {
    // Cerminan tes di atas. Tanpa ini, `cpuPercent: cpu ?? 0` lolos: satu-
    // satunya tes yang menjaga hanya memeriksa RAM dan suhu. Uji mutasi 22
    // Agustus 2026 menemukannya persis begitu.
    mocks.ram.set(1, 71);
    mocks.sensors.set(1, [{ sensor_class: "temperature", sensor_current: 38 }]);
    await cuplikMetrikPerangkat(SEKARANG);
    const [baris] = await cuplikan();
    expect(baris.cpuPercent).toBeNull();
    expect(baris.ramPercent).toBeCloseTo(71, 1);
    expect(baris.tempCelsius).toBeCloseTo(38, 1);
  });

  it("CPU 0% yang MEMANG terbaca tetap tersimpan sebagai 0", async () => {
    // Kebalikan dari tes di atas, dan sama pentingnya: perangkat menganggur
    // benar-benar melaporkan 0. Membuangnya sebagai "tidak terbaca" akan
    // melubangi grafik justru saat keadaannya paling tenang.
    mocks.cpu.set(1, 0);
    await cuplikMetrikPerangkat(SEKARANG);
    const [baris] = await cuplikan();
    expect(baris.cpuPercent).toBe(0);
  });

  it("perangkat yang tidak melaporkan apa pun tidak menulis baris", async () => {
    const hasil = await cuplikMetrikPerangkat(SEKARANG);
    expect(hasil.dicuplik).toBe(0);
    expect(await cuplikan()).toHaveLength(0);
  });

  it("perangkat tanpa padanan LibreNMS dilewati, bukan menggagalkan putaran", async () => {
    mocks.cpu.set(1, 50);
    const hasil = await cuplikMetrikPerangkat(SEKARANG);
    expect(hasil.dicuplik).toBe(1);
    // `olt` (id 2, tak melaporkan apa pun) dan `hsgq` (tanpa id LibreNMS).
    expect(hasil.dilewati).toBe(2);
    expect((await cuplikan()).map((b) => b.assetId)).toEqual(["rtr"]);
    // Dan benar-benar DILEWATI: tidak ada permintaan ke LibreNMS untuknya.
    // Tanpa pemeriksaan ini, membuang penjaganya tetap lolos — hasil akhirnya
    // kebetulan sama, yang berbeda hanya permintaan sia-sia ke `/devices/null`.
    expect(mocks.dipanggil).toEqual([1, 2]);
  });

  it("suhu diambil dari sensor TERPANAS, bukan yang pertama", async () => {
    mocks.sensors.set(1, [
      { sensor_class: "temperature", sensor_current: 31 },
      { sensor_class: "temperature", sensor_current: 57 },
      // Sensor non-suhu tidak boleh ikut terbaca sebagai derajat.
      { sensor_class: "dbm", sensor_current: -21 },
    ]);
    await cuplikMetrikPerangkat(SEKARANG);
    const [baris] = await cuplikan();
    expect(baris.tempCelsius).toBeCloseTo(57, 1);
  });

  it("putaran yang jatuh pada detik yang sama tidak menggagalkan seluruhnya", async () => {
    // Terjadi sesudah worker restart. Tanpa `onConflictDoNothing` seluruh
    // putaran gagal karena satu tabrakan kunci utama.
    mocks.cpu.set(1, 42);
    await cuplikMetrikPerangkat(SEKARANG);
    await expect(cuplikMetrikPerangkat(SEKARANG)).resolves.toMatchObject({ dicuplik: 1 });
    expect(await cuplikan()).toHaveLength(1);
  });

  it("tanpa LibreNMS tidak mencuplik apa pun", async () => {
    mocks.terkonfigurasi = false;
    mocks.cpu.set(1, 42);
    const hasil = await cuplikMetrikPerangkat(SEKARANG);
    expect(hasil.dicuplik).toBe(0);
    expect(await cuplikan()).toHaveLength(0);
  });
});

describe("pangkasCuplikanMetrik", () => {
  it("membuang yang lebih tua dari retensi dan MENYISAKAN yang baru", async () => {
    await d().insert(schema.deviceMetricSamples).values([
      { assetId: "rtr", sampledAt: new Date(SEKARANG.getTime() - 31 * 86_400_000), cpuPercent: 10 },
      { assetId: "rtr", sampledAt: new Date(SEKARANG.getTime() - 29 * 86_400_000), cpuPercent: 20 },
      { assetId: "rtr", sampledAt: SEKARANG, cpuPercent: 30 },
    ]);
    const dibuang = await pangkasCuplikanMetrik(30, SEKARANG);
    expect(dibuang).toBe(1);
    const sisa = (await cuplikan()).map((b) => b.cpuPercent).sort((a, b) => Number(a) - Number(b));
    expect(sisa).toEqual([20, 30]);
  });
});
