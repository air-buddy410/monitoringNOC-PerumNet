// Ujung kabel sebagai SITUS — fakta yang dicatat, bukan garis yang dikarang.
//
// Kabel `BB-KECICANG-PESAGI-144` masuk produksi 22 Agustus 2026 dengan 144
// serat dan NOL terminasi. Sampai saat itu letak kabel hanya bisa diturunkan
// dari tempat core-nya menempel, jadi kabel backbone yang belum dipatch tidak
// punya ujung apa pun — padahal sheet lapangannya menulis "Segment: Kecicang-
// Pesagi" di barisnya yang pertama.
//
// Yang dijaga di sini:
//   1. Ujung tercatat tersimpan dan terbaca.
//   2. Peta TETAP MENOLAK menggambar garis antara dua POP. Jalur nyata
//      mengikuti jalan sepanjang kilometer; garis lurus akan terbaca sebagai
//      rute dan mengirim teknisi ke tempat yang salah.
//   3. Kedua ujung tidak boleh situs yang sama.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));

import * as schema from "@/db/schema";
import { buatKabel, daftarKabel, detailKabel } from "@/server/fiber-store";
import { petaFiber } from "@/server/fiber-geo";

const DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const sqlAll = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => readFileSync(path.join(DIR, f), "utf8")).join("\n");

let client: PGlite;
function d() { return mocks.db as ReturnType<typeof drizzle>; }

beforeEach(async () => {
  client = new PGlite();
  await client.exec(sqlAll);
  mocks.db = drizzle(client, { schema });
  await d().insert(schema.networkSites).values([
    { id: "kcc", code: "KCC", name: "Kecicang", latitude: -8.4498, longitude: 115.5896 },
    { id: "psg", code: "PSG", name: "Pesagi", latitude: -8.4605, longitude: 115.6228 },
  ]);
});

afterEach(async () => { await client.close(); });

async function buatBackbone(siteAId: string | null, siteBId: string | null) {
  return buatKabel(
    {
      code: "BB-UJI-144", name: "Backbone uji", category: "backbone",
      coreCount: 12, tubeSize: 12, siteAId, siteBId,
    },
    null,
  );
}

describe("ujung kabel sebagai situs", () => {
  it("tersimpan dan terbaca", async () => {
    const h = await buatBackbone("kcc", "psg");
    expect(h.ok).toBe(true);
    const [k] = await d().select().from(schema.fiberCableSegments)
      .where(eq(schema.fiberCableSegments.code, "BB-UJI-144"));
    expect(k.siteAId).toBe("kcc");
    expect(k.siteBId).toBe("psg");
  });

  it("boleh dikosongkan — dropcore memang tidak membentang antar situs", async () => {
    const h = await buatBackbone(null, null);
    expect(h.ok).toBe(true);
    const [k] = await d().select().from(schema.fiberCableSegments)
      .where(eq(schema.fiberCableSegments.code, "BB-UJI-144"));
    expect(k.siteAId).toBeNull();
    expect(k.siteBId).toBeNull();
  });

  it("dua ujung TIDAK boleh situs yang sama", async () => {
    // "Dari Kecicang ke Kecicang" bukan bentangan antar-situs; membiarkannya
    // membuat "dari mana ke mana" jadi kalimat kosong.
    const h = await buatBackbone("kcc", "kcc");
    expect(h.ok).toBe(false);
    if (!h.ok) expect(h.status).toBe(400);
  });

  it("situs yang dihapus membuat ujungnya NULL, bukan menghapus kabelnya", async () => {
    await buatBackbone("kcc", "psg");
    await d().delete(schema.networkSites).where(eq(schema.networkSites.id, "kcc"));
    const [k] = await d().select().from(schema.fiberCableSegments)
      .where(eq(schema.fiberCableSegments.code, "BB-UJI-144"));
    expect(k).toBeDefined();
    expect(k.siteAId).toBeNull();
    expect(k.siteBId).toBe("psg");
  });
});

describe("ujung terbaca lewat API kabel", () => {
  it("daftarKabel mengirim kode DAN nama kedua ujungnya", async () => {
    await buatBackbone("kcc", "psg");
    const [k] = await daftarKabel();
    expect(k.siteA).toMatchObject({ code: "KCC", name: "Kecicang" });
    expect(k.siteB).toMatchObject({ code: "PSG", name: "Pesagi" });
  });

  it("detailKabel tetap DATAR — kontrak lama tidak pecah", async () => {
    // Layar kabel sudah membaca `code`, `coreCount`, dan seterusnya di
    // tingkat atas. Membungkusnya jadi `{ kabel: … }` demi dua kolom baru
    // akan memecah kontrak yang sudah dipakai.
    await buatBackbone("kcc", "psg");
    const [k] = await daftarKabel();
    const d = await detailKabel(k.id);
    expect(d?.code).toBe("BB-UJI-144");
    expect(d?.coreCount).toBe(12);
    expect(d?.cores).toHaveLength(12);
    expect(d?.siteA).toMatchObject({ code: "KCC" });
    expect(d?.siteB).toMatchObject({ code: "PSG" });
  });

  it("kabel tanpa ujung mengirim null, bukan objek berisi null", async () => {
    await buatBackbone(null, null);
    const [k] = await daftarKabel();
    expect(k.siteA).toBeNull();
    expect(k.siteB).toBeNull();
  });
});

describe("jalur tersimpan dipakai peta", () => {
  /** Terminasi dua ujung supaya kabelnya punya jangkar dan bisa digambar. */
  async function beriJangkar(kode: string) {
    const otbStore = await import("@/server/otb-store");
    const fiber = await import("@/server/fiber-store");
    const [k] = await d().select().from(schema.fiberCableSegments)
      .where(eq(schema.fiberCableSegments.code, kode));
    for (const [ujung, kodeOtb, lat, lon] of [
      ["A", "OTB-A", -8.4498, 115.5896],
      ["B", "OTB-B", -8.4605, 115.6228],
    ] as const) {
      const h = await otbStore.buatOtb(
        { code: kodeOtb, name: kodeOtb, trayCount: 1, portsPerTray: 4, latitude: lat, longitude: lon },
        null,
      );
      if (!h.ok) throw new Error(h.error);
      const [port] = await d().select().from(schema.otbPorts)
        .where(eq(schema.otbPorts.otbId, h.data.id)).limit(1);
      const [core] = await d().select().from(schema.fiberCores)
        .where(eq(schema.fiberCores.segmentId, k.id)).limit(1);
      const r = await fiber.terminasiCore(
        { coreId: core.id, coreEnd: ujung, otbPortId: port.id, reason: "uji" },
        null,
      );
      if (!r.ok) throw new Error(r.error);
    }
    return k.id;
  }

  it("tanpa jalur → garis lurus, dan MENGAKU begitu", async () => {
    await buatBackbone("kcc", "psg");
    await beriJangkar("BB-UJI-144");
    const peta = await petaFiber();
    expect(peta.garis[0].koordinat).toHaveLength(2);
    expect(peta.garis[0].sumberGeometri).toBe("garis-lurus");
  });

  it("dengan jalur → deret penuh dipakai, sumbernya disebut", async () => {
    await buatBackbone("kcc", "psg");
    const id = await beriJangkar("BB-UJI-144");
    await d().update(schema.fiberCableSegments)
      .set({
        route: [[115.5896, -8.4498], [115.60, -8.44], [115.61, -8.47], [115.6228, -8.4605]],
        routeSource: "tersurvei",
      })
      .where(eq(schema.fiberCableSegments.id, id));
    const peta = await petaFiber();
    expect(peta.garis[0].koordinat).toHaveLength(4);
    expect(peta.garis[0].sumberGeometri).toBe("tersurvei");
  });

  it("jalur tanpa route_source dianggap PERKIRAAN, bukan tersurvei", async () => {
    // Menganggapnya tersurvei berarti menaikkan kepercayaan atas dasar kolom
    // yang kosong.
    await buatBackbone("kcc", "psg");
    const id = await beriJangkar("BB-UJI-144");
    await d().update(schema.fiberCableSegments)
      .set({ route: [[115.5896, -8.4498], [115.6228, -8.4605]] })
      .where(eq(schema.fiberCableSegments.id, id));
    const peta = await petaFiber();
    expect(peta.garis[0].sumberGeometri).toBe("perkiraan-jalan");
  });

  it("jalur CACAT tidak dipakai diam-diam — jatuh ke garis lurus dan dilaporkan", async () => {
    // Lat/lon tertukar. Menggambarnya akan menaruh kabel di Samudra Hindia.
    await buatBackbone("kcc", "psg");
    const id = await beriJangkar("BB-UJI-144");
    await d().update(schema.fiberCableSegments)
      .set({ route: [[-8.4498, 115.5896], [-8.4605, 115.6228]], routeSource: "tersurvei" })
      .where(eq(schema.fiberCableSegments.id, id));
    const peta = await petaFiber();
    expect(peta.garis[0].koordinat).toHaveLength(2);
    expect(peta.garis[0].sumberGeometri).toBe("garis-lurus");
    expect(peta.jalurRusak).toHaveLength(1);
    expect(peta.jalurRusak[0].pesan).toMatch(/tertukar/);
  });
});

describe("kabel berjalur digambar TANPA jangkar", () => {
  it("jalur tersimpan cukup — tidak perlu satu terminasi pun", async () => {
    // Ini yang membuat kabel distribusi ke ODP bisa tergambar tanpa menyentuh
    // port ODP produksi. Di produksi 1.687 port membawa layanan pelanggan;
    // memakainya untuk kabel turunan akan merusak angka okupansi yang dipakai
    // orang menjual sambungan.
    await buatBackbone("kcc", "psg");
    const [k] = await d().select().from(schema.fiberCableSegments)
      .where(eq(schema.fiberCableSegments.code, "BB-UJI-144"));
    await d().update(schema.fiberCableSegments)
      .set({
        route: [[115.5896, -8.4498], [115.60, -8.45], [115.6228, -8.4605]],
        routeSource: "perkiraan-jalan",
      })
      .where(eq(schema.fiberCableSegments.id, k.id));

    const peta = await petaFiber();
    expect(peta.garis).toHaveLength(1);
    expect(peta.garis[0].koordinat).toHaveLength(3);
    expect(peta.garis[0].sumberGeometri).toBe("perkiraan-jalan");
    // Tanpa terminasi, kedua simpulnya memang tidak ada — dan itu `null`,
    // bukan objek kosong yang menyamar jadi simpul.
    expect(peta.garis[0].dari).toBeNull();
    expect(peta.garis[0].ke).toBeNull();
    expect(peta.garis[0].coreTerpakai).toBe(0);
    expect(peta.tanpaGeometri).toHaveLength(0);
  });

  it("jalur CACAT tanpa jangkar tetap tidak digambar", async () => {
    await buatBackbone("kcc", "psg");
    const [k] = await d().select().from(schema.fiberCableSegments)
      .where(eq(schema.fiberCableSegments.code, "BB-UJI-144"));
    await d().update(schema.fiberCableSegments)
      .set({ route: [[-8.4498, 115.5896], [-8.4605, 115.6228]], routeSource: "tersurvei" })
      .where(eq(schema.fiberCableSegments.id, k.id));
    const peta = await petaFiber();
    expect(peta.garis).toHaveLength(0);
    expect(peta.jalurRusak).toHaveLength(1);
    expect(peta.tanpaGeometri).toHaveLength(1);
  });
});

describe("peta tetap menolak menggambar garis antar-POP", () => {
  it("kabel tanpa terminasi TIDAK digambar walau kedua ujungnya tercatat", async () => {
    // Inti seluruh berkas ini. Kolom ujung ditambahkan untuk MENJELASKAN,
    // bukan untuk menggambar — jalur nyata mengikuti jalan sepanjang
    // kilometer, dan garis lurus akan terbaca sebagai rute.
    await buatBackbone("kcc", "psg");
    const peta = await petaFiber();
    expect(peta.garis).toHaveLength(0);
    expect(peta.tanpaGeometri).toHaveLength(1);
  });

  it("alasannya berubah dari 'tidak tahu' jadi 'ujungnya tahu, jalurnya belum'", async () => {
    await buatBackbone("kcc", "psg");
    const peta = await petaFiber();
    const [t] = peta.tanpaGeometri;
    expect(t.ujungTercatat).toEqual({ a: "KCC", b: "PSG" });
    expect(t.alasan).toMatch(/KCC → PSG/);
    expect(t.alasan).toMatch(/belum tersurvei/);
  });

  it("kabel tanpa ujung tercatat tetap beralasan polos, tanpa ujungTercatat", async () => {
    await buatBackbone(null, null);
    const peta = await petaFiber();
    const [t] = peta.tanpaGeometri;
    expect(t.ujungTercatat).toBeUndefined();
    expect(t.alasan).not.toMatch(/tersurvei/);
  });

  it("satu ujung saja tetap disebutkan, dengan sisi yang kosong ditandai", async () => {
    await buatBackbone("kcc", null);
    const peta = await petaFiber();
    const [t] = peta.tanpaGeometri;
    expect(t.ujungTercatat).toEqual({ a: "KCC", b: null });
    expect(t.alasan).toMatch(/KCC → \?/);
  });
});
