// Grid optik OLT — dari sensor, bukan dari pembangkit angka.
//
// Sampai 22 Agustus 2026 `getOltOptics` jatuh ke `generateOpticalHealth()`
// untuk setiap OLT yang tidak terpetakan ke LibreNMS. Di produksi itu berarti
// `HSGQ-100-Kecicang` menampilkan 4 port PON dengan daya pancar karangan —
// +3,7 dBm dan seterusnya — tanpa apa pun di payload yang mengatakannya.
//
// Perangkat itu justru yang diputuskan pemilik dibaca lewat konsol CLI dan
// memang tidak akan pernah punya data LibreNMS. Jadi karangannya bukan
// sementara: ia permanen.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  terkonfigurasi: true,
  petaAset: [{ assetId: "olt-lnms", librenmsDeviceId: 3 }] as Array<{
    assetId: string;
    librenmsDeviceId: number | null;
  }>,
  sensors: [] as unknown[],
}));

vi.mock("@/server/cache", () => ({
  cache: { get: async () => null, set: async () => {}, del: async () => {} },
}));
vi.mock("@/server/device-store", () => ({
  getAssetsWithStatus: async () => ({ assets: mocks.petaAset }),
}));
vi.mock("@/server/librenms", async (asli) => ({
  ...(await asli<typeof import("@/server/librenms")>()),
  isLibrenmsConfigured: () => mocks.terkonfigurasi,
  fetchHealthSensors: async (_id: number, kelas: string) =>
    kelas === "device_dbm" ? mocks.sensors : [],
}));

import { getOltOptics } from "@/server/metrics-store";

beforeEach(() => {
  mocks.terkonfigurasi = true;
  mocks.petaAset = [
    { assetId: "olt-lnms", librenmsDeviceId: 3 },
    // HSGQ-100-Kecicang: dibaca lewat konsol CLI, tidak akan pernah di LibreNMS.
    { assetId: "olt-cli", librenmsDeviceId: null },
  ];
  mocks.sensors = [];
});

describe("getOltOptics", () => {
  it("OLT tanpa padanan LibreNMS TIDAK diisi angka karangan", async () => {
    const o = await getOltOptics("olt-cli");
    expect(o.sumber).toBe("belum-ada-data");
    expect(o.ports).toEqual([]);
    expect(o.catatan).toMatch(/tidak terdaftar di LibreNMS/i);
  });

  it("OLT terpetakan tapi tanpa sensor dbm mengaku belum ada data", async () => {
    // Keadaan produksi hari ini untuk kelima OLT ZTE/HSGQ yang ber-SNMP:
    // `/health/device_dbm` menjawab `{"graphs":[],"count":0}`.
    const o = await getOltOptics("olt-lnms");
    expect(o.sumber).toBe("belum-ada-data");
    expect(o.ports).toEqual([]);
    expect(o.catatan).toMatch(/sensor optik/i);
  });

  it("sensor dbm yang ada dibaca dan mengaku terukur", async () => {
    mocks.sensors = [
      { sensor_class: "dbm", sensor_descr: "gpon-olt_1/1", sensor_current: -18.42 },
      { sensor_class: "dbm", sensor_descr: "gpon-olt_1/2", sensor_current: 2.5 },
    ];
    const o = await getOltOptics("olt-lnms");
    expect(o.sumber).toBe("terukur");
    expect(o.ports.map((p) => p.port)).toEqual(["gpon-olt_1/1", "gpon-olt_1/2"]);
    expect(o.ports[0].txPower).toBeCloseTo(-18.4, 1);
    expect(o.ports.every((p) => p.sfpUp)).toBe(true);
  });

  it("sensor dbm tanpa pembacaan → txPower null, BUKAN 0 dBm", async () => {
    // 0 dBm adalah 1 mW: pembacaan optik yang sangat kuat. "Tidak diketahui"
    // yang digambar 0 tidak sekadar meleset — ia tampil sebagai kondisi
    // terbaik yang mungkin, tepat pada layar yang dipakai mencari redaman.
    mocks.sensors = [
      { sensor_class: "dbm", sensor_descr: "gpon-olt_1/3", sensor_current: null },
    ];
    const o = await getOltOptics("olt-lnms");
    expect(o.ports[0].txPower).toBeNull();
    expect(o.ports[0].sfpUp).toBe(false);
  });

  it("tanpa LibreNMS deret tiruan tetap dikirim TAPI mengaku fixture", async () => {
    // Supaya layar bisa dikerjakan di pengembangan — aturan yang sama dengan
    // laporan SLA dan riwayat metrik.
    mocks.terkonfigurasi = false;
    const o = await getOltOptics("olt-lnms");
    expect(o.sumber).toBe("fixture");
    expect(o.ports.length).toBeGreaterThan(0);
  });
});
