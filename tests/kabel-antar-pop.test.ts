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
import { buatKabel } from "@/server/fiber-store";
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
