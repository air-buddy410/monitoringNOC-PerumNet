// Garis jalur fiber di peta (Fase 15).
//
// Satu aturan yang menentukan seluruh berkas ini: kabel yang letaknya tidak
// diketahui TIDAK DIGAMBAR. Ia masuk daftar `tanpaGeometri` beserta alasannya.
//
// Garis tebakan di peta jaringan bukan ketidaknyamanan kecil — ia dipakai
// orang untuk memutuskan ke mana berangkat saat kabel putus, dan garis yang
// salah mengirim teknisi ke tempat yang salah dengan keyakinan penuh.
// Karena itu setiap tes di bawah menguji satu bentuk "tidak tahu" yang
// berbeda, dan menuntut semuanya berakhir sebagai penolakan menggambar.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/server/rbac", () => ({
  withRole:
    (_r: string[], h: (a: Request, u: unknown, c: unknown) => Promise<Response>) =>
    (request: Request, context: unknown) =>
      h(request, { id: "u1", name: "P", email: "p@c.id", role: "admin" }, context),
}));

import * as schema from "@/db/schema";
import * as authSchema from "@/db/auth-schema";
import { buatOtb } from "@/server/otb-store";
import { buatKabel, detailKabel, terminasiCore } from "@/server/fiber-store";
import { buatClosure, pasangSilangan } from "@/server/closure-store";
import { petaFiber } from "@/server/fiber-geo";

const DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const sqlAll = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => readFileSync(path.join(DIR, f), "utf8")).join("\n");

let client: PGlite;
let portOtb: string[];
let kabel: Record<string, { id: string; cores: { id: string; coreNumber: number }[] }>;

function d() { return mocks.db as ReturnType<typeof drizzle>; }
function core(kode: string, n: number) {
  return kabel[kode].cores.find((c) => c.coreNumber === n)!.id;
}
async function buat(kode: string, panjang: number | null = 800) {
  const h = await buatKabel({ code: kode, category: "feeder", coreCount: 4, lengthM: panjang }, "u1");
  if (!h.ok) throw new Error(h.error);
  kabel[kode] = { id: h.data.id, cores: (await detailKabel(h.data.id))!.cores };
}

beforeEach(async () => {
  client = new PGlite();
  await client.exec(sqlAll);
  mocks.db = drizzle(client, { schema: { ...schema, ...authSchema } });
  kabel = {};
  await d().insert(authSchema.user).values({
    id: "u1", name: "P", email: "p@c.id",
    emailVerified: true, createdAt: new Date(), updatedAt: new Date(),
  });
  const o = await buatOtb(
    { code: "OTB-1", name: "OTB Satu", connectorType: "LC", trayCount: 1,
      latitude: -8.44, longitude: 115.59 }, "u1");
  if (!o.ok) throw new Error(o.error);
  portOtb = (await d().select().from(schema.otbPorts).orderBy(schema.otbPorts.globalPortNumber))
    .map((p) => p.id);
  await d().insert(schema.odps).values([
    { id: "odp1", code: "ODP-1", name: "ODP Satu", role: "ODP", capacity: 8, latitude: -8.46, longitude: 115.61 },
    { id: "odpX", code: "ODP-X", name: "Tanpa Koordinat", role: "ODP", capacity: 8 },
  ]);
  await d().insert(schema.odpPorts).values([
    { id: "odp1-p1", odpId: "odp1", portNumber: 1 },
    { id: "odpX-p1", odpId: "odpX", portNumber: 1 },
  ]);
});

afterEach(async () => { await client.close(); });

describe("kabel yang letaknya diketahui", () => {
  it("digambar sebagai garis antara kedua jangkarnya", async () => {
    await buat("KBL-1");
    await terminasiCore({ coreId: core("KBL-1", 1), coreEnd: "A", otbPortId: portOtb[0], reason: "x" }, "u1");
    await d().update(schema.fiberCores).set({ purpose: "distribution" })
      .where(eq(schema.fiberCores.id, core("KBL-1", 1)));
    await terminasiCore({ coreId: core("KBL-1", 1), coreEnd: "B", odpPortId: "odp1-p1", reason: "y" }, "u1");

    const p = await petaFiber();
    expect(p.ringkas).toMatchObject({ kabelAktif: 1, tergambar: 1, tanpaGeometri: 0 });
    const g = p.garis[0];
    // GeoJSON: [lon, lat] — bukan sebaliknya. Tertukar berarti kabelnya
    // muncul di Samudra Hindia dan tidak ada yang bisa menjelaskan kenapa.
    expect(g.koordinat).toEqual([[115.59, -8.44], [115.61, -8.46]]);
    expect(g.dari).toMatchObject({ jenis: "OTB", code: "OTB-1" });
    expect(g.ke).toMatchObject({ jenis: "ODP", code: "ODP-1" });
    expect(g.coreTerpakai).toBe(2);
    expect(p.simpul.map((s) => s.code).sort()).toEqual(["ODP-1", "OTB-1"]);
  });

  it("closure jadi jangkar untuk kabel yang disambung di sana", async () => {
    await buat("KBL-A");
    await buat("KBL-B");
    const c = await buatClosure({ code: "CL-1", latitude: -8.45, longitude: 115.6 }, "u1");
    if (!c.ok) throw new Error(c.error);
    await terminasiCore({ coreId: core("KBL-A", 1), coreEnd: "A", otbPortId: portOtb[0], reason: "x" }, "u1");
    await pasangSilangan(c.data.id, [{
      inputCoreId: core("KBL-A", 1), inputCoreEnd: "B",
      outputCoreId: core("KBL-B", 1), outputCoreEnd: "A",
    }], "silang", "u1");

    const p = await petaFiber();
    const a = p.garis.find((g) => g.code === "KBL-A")!;
    expect(a.dari.jenis).toBe("OTB");
    expect(a.ke).toMatchObject({ jenis: "CLOSURE", code: "CL-1" });
    // KBL-B baru satu ujungnya yang tersambung.
    expect(p.tanpaGeometri.map((t) => t.code)).toContain("KBL-B");
  });
});

describe("kabel yang letaknya TIDAK diketahui — tidak digambar", () => {
  it("belum ada core yang tersambung sama sekali", async () => {
    await buat("KBL-KOSONG");
    const p = await petaFiber();
    expect(p.garis).toHaveLength(0);
    expect(p.tanpaGeometri[0].alasan).toMatch(/kedua ujungnya belum diketahui/i);
  });

  it("hanya satu ujung yang tersambung", async () => {
    await buat("KBL-SEBELAH");
    await terminasiCore({ coreId: core("KBL-SEBELAH", 1), coreEnd: "A", otbPortId: portOtb[0], reason: "x" }, "u1");
    const p = await petaFiber();
    expect(p.garis).toHaveLength(0);
    expect(p.tanpaGeometri[0].alasan).toMatch(/satu ujung/i);
  });

  it("jangkarnya ada tapi belum punya koordinat", async () => {
    // ODP-X nyata dan tersambung, tapi belum disurvei. Menggambarnya butuh
    // menebak letaknya, dan menebak itu justru yang dilarang.
    await buat("KBL-BUTA");
    await d().update(schema.fiberCores).set({ purpose: "distribution" })
      .where(eq(schema.fiberCores.segmentId, kabel["KBL-BUTA"].id));
    await terminasiCore({ coreId: core("KBL-BUTA", 1), coreEnd: "A", otbPortId: portOtb[0], reason: "x" }, "u1");
    await terminasiCore({ coreId: core("KBL-BUTA", 1), coreEnd: "B", odpPortId: "odpX-p1", reason: "y" }, "u1");

    const p = await petaFiber();
    expect(p.garis).toHaveLength(0);
    expect(p.tanpaGeometri[0].alasan).toMatch(/ODP-X belum punya koordinat/);
  });

  it("satu ujung menempel di dua tempat berbeda", async () => {
    // Bisa saja benar di lapangan — core-core satu kabel berakhir di ODP yang
    // berbeda. Tapi satu garis lurus tidak bisa mewakilinya, dan memilih
    // salah satunya berarti memilih diam-diam.
    await buat("KBL-CABANG");
    await d().update(schema.fiberCores).set({ purpose: "distribution" })
      .where(eq(schema.fiberCores.segmentId, kabel["KBL-CABANG"].id));
    await terminasiCore({ coreId: core("KBL-CABANG", 1), coreEnd: "A", otbPortId: portOtb[0], reason: "x" }, "u1");
    await terminasiCore({ coreId: core("KBL-CABANG", 1), coreEnd: "B", odpPortId: "odp1-p1", reason: "y" }, "u1");
    await terminasiCore({ coreId: core("KBL-CABANG", 2), coreEnd: "B", odpPortId: "odpX-p1", reason: "z" }, "u1");

    const p = await petaFiber();
    expect(p.garis).toHaveLength(0);
    expect(p.tanpaGeometri[0].alasan).toMatch(/2 tempat berbeda/);
  });

  it("kabel nonaktif tidak ikut, dan tidak dilaporkan sebagai masalah", async () => {
    await buat("KBL-MATI");
    await d().update(schema.fiberCableSegments).set({ status: "nonaktif" })
      .where(eq(schema.fiberCableSegments.id, kabel["KBL-MATI"].id));
    const p = await petaFiber();
    expect(p.ringkas).toMatchObject({ kabelAktif: 0, tergambar: 0, tanpaGeometri: 0 });
  });
});
