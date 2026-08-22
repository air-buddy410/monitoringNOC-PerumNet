// Riwayat metrik perangkat — dari pengukuran, bukan dari pembangkit angka.
//
// Sampai 22 Agustus 2026 endpoint ini SELALU mengarang deretnya, tanpa
// mengatakannya. Bentuknya benar, angkanya tidak pernah diukur, dan tidak ada
// yang bisa membedakan — kelas kesalahan yang sama dengan laporan SLA yang
// dulu menanam angka fixture ke produksi.
//
// Yang dijaga di sini:
//   1. Bandwidth dibaca dari `traffic_samples` kalau ada, dan mengaku
//      `terukur`.
//   2. Jeda pengukuran jadi `null`, BUKAN 0. Nol berarti trafik berhenti;
//      null berarti kami tidak tahu.
//   3. Metrik yang tidak punya sumber MENGAKU tidak punya — tidak diganti
//      angka yang terlihat masuk akal.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));

import * as schema from "@/db/schema";
import { riwayatMetrik } from "@/server/metrics-history";

const DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const sqlAll = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => readFileSync(path.join(DIR, f), "utf8")).join("\n");

let client: PGlite;
const SEKARANG = new Date("2026-08-22T12:00:00.000Z");

function d() { return mocks.db as ReturnType<typeof drizzle>; }

beforeEach(async () => {
  client = new PGlite();
  await client.exec(sqlAll);
  mocks.db = drizzle(client, { schema });
  // LibreNMS dianggap terkonfigurasi: itu keadaan produksi, dan yang
  // membedakan "belum ada data" dari "deret tiruan pengembangan".
  process.env.LIBRENMS_URL = "https://nms.uji";
  process.env.LIBRENMS_TOKEN = "uji";

  await d().insert(schema.assets).values([
    { assetId: "rtr", hostname: "192.168.100.1", displayName: "Router Distribusi", managementIp: "192.168.100.1", vendor: "MikroTik", site: "Nagabasukih", networkRole: "distribution" },
    { assetId: "olt", hostname: "192.168.100.60", displayName: "ZTE C600", managementIp: "192.168.100.60", vendor: "ZTE", site: "Kecicang", networkRole: "olt" },
  ]);
  await d().insert(schema.trafficInterfaces).values([
    { id: "if-up", routerName: "192.168.100.1", ifName: "ether1", label: "Uplink", role: "uplink", isEnabled: true },
    { id: "if-lain", routerName: "192.168.100.1", ifName: "ether2", label: "Situs", role: "site", isEnabled: true },
  ]);
});

afterEach(async () => {
  delete process.env.LIBRENMS_URL;
  delete process.env.LIBRENMS_TOKEN;
  await client.close();
});

/** Cuplikan tiap 2 menit selama `menit` terakhir. */
async function isiSampel(interfaceId: string, menit: number, bps: number) {
  const baris = [];
  for (let m = menit; m >= 0; m -= 2) {
    const t = new Date(SEKARANG.getTime() - m * 60_000);
    baris.push({
      interfaceId, sampledAt: t,
      rxBps: bps, txBps: bps / 2,
      rxByte: BigInt(0), txByte: BigInt(0), dtMs: 120_000,
    });
  }
  await d().insert(schema.trafficSamples).values(baris);
}

describe("bandwidth dari pengukuran", () => {
  it("membaca traffic_samples dan mengaku terukur", async () => {
    await isiSampel("if-up", 120, 20_000_000);
    const h = await riwayatMetrik({ assetId: "rtr", metric: "bandwidth", hours: 24, now: SEKARANG });
    expect(h.sumber).toBe("terukur");
    expect(h.titikTerukur).toBeGreaterThan(0);
    // rx 20 Mbps + tx 10 Mbps = 30 Mbps.
    const terisi = h.points.filter((p) => p.value !== null);
    expect(terisi[0].value).toBeCloseTo(30, 1);
  });

  it("jeda pengukuran jadi null, BUKAN nol", async () => {
    // Dua jam terakhir saja yang punya data; sisanya jendela 24 jam kosong.
    await isiSampel("if-up", 120, 10_000_000);
    const h = await riwayatMetrik({ assetId: "rtr", metric: "bandwidth", hours: 24, now: SEKARANG });
    const kosong = h.points.filter((p) => p.value === null);
    expect(kosong.length).toBeGreaterThan(0);
    // Kalau jeda digambar 0, ini akan menemukan nol-nol itu.
    expect(h.points.some((p) => p.value === 0)).toBe(false);
  });

  it("hanya interface UPLINK yang dijumlahkan", async () => {
    // Trafik yang masuk lewat satu port keluar lewat port lain; menjumlahkan
    // semuanya menghitung lalu lintas yang sama dua kali.
    await isiSampel("if-up", 60, 10_000_000);
    await isiSampel("if-lain", 60, 90_000_000);
    const h = await riwayatMetrik({ assetId: "rtr", metric: "bandwidth", hours: 24, now: SEKARANG });
    const terisi = h.points.filter((p) => p.value !== null);
    // 10 + 5 = 15 Mbps. Kalau if-lain ikut, angkanya jadi 150.
    expect(terisi[0].value).toBeCloseTo(15, 1);
  });

  it("cuplikan acuan (dt_ms = 0) tidak digambar sebagai 0 bps", async () => {
    await d().insert(schema.trafficSamples).values({
      interfaceId: "if-up", sampledAt: new Date(SEKARANG.getTime() - 60_000),
      rxBps: 0, txBps: 0, rxByte: BigInt(0), txByte: BigInt(0), dtMs: 0,
    });
    const h = await riwayatMetrik({ assetId: "rtr", metric: "bandwidth", hours: 24, now: SEKARANG });
    expect(h.sumber).toBe("belum-ada-data");
    expect(h.points.every((p) => p.value === null)).toBe(true);
  });

  it("perangkat tanpa interface uplink mengaku belum ada data", async () => {
    const h = await riwayatMetrik({ assetId: "olt", metric: "bandwidth", hours: 24, now: SEKARANG });
    expect(h.sumber).toBe("belum-ada-data");
    expect(h.catatan).toMatch(/192\.168\.100\.60/);
    expect(h.points).toHaveLength(96);
    expect(h.points.every((p) => p.value === null)).toBe(true);
  });
});

/** Cuplikan CPU/RAM/suhu tiap 5 menit selama `menit` terakhir. */
async function isiCuplikan(
  assetId: string,
  menit: number,
  nilai: { cpu?: number | null; ram?: number | null; suhu?: number | null },
) {
  const baris = [];
  for (let m = menit; m >= 0; m -= 5) {
    baris.push({
      assetId,
      sampledAt: new Date(SEKARANG.getTime() - m * 60_000),
      cpuPercent: nilai.cpu ?? null,
      ramPercent: nilai.ram ?? null,
      tempCelsius: nilai.suhu ?? null,
    });
  }
  await d().insert(schema.deviceMetricSamples).values(baris);
}

describe("cpu, ram, dan suhu dari cuplikan tersimpan", () => {
  it("membaca device_metric_samples dan mengaku terukur", async () => {
    await isiCuplikan("rtr", 120, { cpu: 42, ram: 71, suhu: 38 });
    const harap = { cpu: 42, ram: 71, suhu: 38 };
    for (const metric of ["cpu", "ram", "suhu"] as const) {
      const h = await riwayatMetrik({ assetId: "rtr", metric, hours: 24, now: SEKARANG });
      expect(h.sumber, metric).toBe("terukur");
      expect(h.titikTerukur, metric).toBeGreaterThan(0);
      const terisi = h.points.filter((p) => p.value !== null);
      expect(terisi[0].value, metric).toBeCloseTo(harap[metric], 1);
    }
  });

  it("jeda cuplikan jadi null, BUKAN nol", async () => {
    // Dua jam terakhir saja; sisa jendela 24 jam kosong. Perangkat yang mati
    // enam jam harus menggambar enam jam kosong — garis 0% terbaca sebagai
    // "menganggur", kebalikan dari yang terjadi.
    await isiCuplikan("rtr", 120, { cpu: 55 });
    const h = await riwayatMetrik({ assetId: "rtr", metric: "cpu", hours: 24, now: SEKARANG });
    expect(h.points.filter((p) => p.value === null).length).toBeGreaterThan(0);
    expect(h.points.some((p) => p.value === 0)).toBe(false);
  });

  it("metrik yang null tidak ikut dirata-rata sebagai nol", async () => {
    // Perangkat ini melaporkan CPU tapi tidak RAM — barisnya ada, kolom RAM-nya
    // null. Kalau null ikut agregasi sebagai 0, rata-ratanya jatuh ke bawah.
    await isiCuplikan("rtr", 120, { cpu: 80, ram: null });
    const cpu = await riwayatMetrik({ assetId: "rtr", metric: "cpu", hours: 24, now: SEKARANG });
    expect(cpu.sumber).toBe("terukur");
    expect(cpu.points.filter((p) => p.value !== null)[0].value).toBeCloseTo(80, 1);
    // RAM-nya harus mengaku belum ada, bukan menggambar 0%.
    const ram = await riwayatMetrik({ assetId: "rtr", metric: "ram", hours: 24, now: SEKARANG });
    expect(ram.sumber).toBe("belum-ada-data");
    expect(ram.points.every((p) => p.value === null)).toBe(true);
  });

  it("cuplikan perangkat lain tidak bocor ke perangkat ini", async () => {
    await isiCuplikan("olt", 120, { cpu: 90 });
    const h = await riwayatMetrik({ assetId: "rtr", metric: "cpu", hours: 24, now: SEKARANG });
    expect(h.sumber).toBe("belum-ada-data");
    expect(h.points.every((p) => p.value === null)).toBe(true);
  });

  it("cuplikan di luar rentang jam yang diminta tidak ikut", async () => {
    // Hanya cuplikan berumur 20–24 jam; permintaan 6 jam harus kosong.
    await d().insert(schema.deviceMetricSamples).values({
      assetId: "rtr",
      sampledAt: new Date(SEKARANG.getTime() - 22 * 3_600_000),
      cpuPercent: 65, ramPercent: null, tempCelsius: null,
    });
    const enam = await riwayatMetrik({ assetId: "rtr", metric: "cpu", hours: 6, now: SEKARANG });
    expect(enam.sumber).toBe("belum-ada-data");
    const duaEmpat = await riwayatMetrik({ assetId: "rtr", metric: "cpu", hours: 24, now: SEKARANG });
    expect(duaEmpat.sumber).toBe("terukur");
    expect(duaEmpat.titikTerukur).toBe(1);
  });
});

describe("metrik yang belum punya cuplikan", () => {
  it("cpu, ram, dan suhu mengaku belum ada data — bukan angka karangan", async () => {
    for (const metric of ["cpu", "ram", "suhu"] as const) {
      const h = await riwayatMetrik({ assetId: "rtr", metric, hours: 24, now: SEKARANG });
      expect(h.sumber, metric).toBe("belum-ada-data");
      expect(h.points.every((p) => p.value === null), metric).toBe(true);
      expect(h.catatan, metric).toMatch(/[Bb]elum ada cuplikan/);
    }
  });

  it("titik tetap dikirim walau kosong — grafik hilang terbaca sebagai belum dimuat", async () => {
    const h = await riwayatMetrik({ assetId: "rtr", metric: "cpu", hours: 24, now: SEKARANG });
    expect(h.points).toHaveLength(96);
    expect(new Date(h.points[0].time).getTime()).toBeLessThan(SEKARANG.getTime());
  });

  it("tanpa LibreNMS, deret tiruan tetap dikirim TAPI mengaku fixture", async () => {
    // Supaya layar grafik bisa dikerjakan di pengembangan — aturan yang sama
    // dengan laporan SLA.
    delete process.env.LIBRENMS_URL;
    delete process.env.LIBRENMS_TOKEN;
    const h = await riwayatMetrik({ assetId: "rtr", metric: "cpu", hours: 24, now: SEKARANG });
    expect(h.sumber).toBe("fixture");
    expect(h.points.some((p) => typeof p.value === "number")).toBe(true);
  });
});
