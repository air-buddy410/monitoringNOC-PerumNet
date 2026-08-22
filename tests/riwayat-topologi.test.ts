// Riwayat topologi (Fase 16).
//
// Tidak ada tabel baru — seluruh riwayat sudah tertulis sejak Fase 11. Yang
// diuji di sini cara membacanya, dan dua sifat yang mudah salah:
//
//   1. RUANG LINGKUP. Riwayat sebuah OTB harus mencakup tray dan portnya.
//      Menyaring mentah per `entity_id` menghasilkan satu baris — pembuatan
//      OTB-nya sendiri — dan layar riwayat yang selalu berisi satu baris
//      terlihat berfungsi padahal tidak berguna.
//
//   2. HALAMAN. Pemasangan silangan massal menulis beberapa baris pada
//      milidetik yang SAMA. Penanda halaman berbasis waktu saja akan
//      melewatkan sebagiannya atau mengulangnya, dan tidak ada yang akan
//      menyadarinya karena riwayat memang tidak pernah dihitung ulang.

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
      h(request, { id: "u1", name: "Penguji", email: "p@c.id", role: "admin" }, context),
}));

import * as schema from "@/db/schema";
import * as authSchema from "@/db/auth-schema";
import { buatOtb, aturKapasitasTray, ubahPort } from "@/server/otb-store";
import { buatKabel, detailKabel, terminasiCore } from "@/server/fiber-store";
import { riwayatTopologi } from "@/server/riwayat-store";
import { GET } from "@/app/api/v1/ftth/riwayat/route";

const DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const sqlAll = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => readFileSync(path.join(DIR, f), "utf8")).join("\n");

let client: PGlite;
let otbId: string;

function d() { return mocks.db as ReturnType<typeof drizzle>; }

beforeEach(async () => {
  client = new PGlite();
  await client.exec(sqlAll);
  mocks.db = drizzle(client, { schema: { ...schema, ...authSchema } });
  await d().insert(authSchema.user).values({
    id: "u1", name: "Penguji", email: "p@c.id",
    emailVerified: true, createdAt: new Date(), updatedAt: new Date(),
  });
  const o = await buatOtb(
    { code: "OTB-1", name: "OTB Satu", connectorType: "LC", trayCount: 2,
      latitude: -8.44, longitude: 115.59 }, "u1");
  if (!o.ok) throw new Error(o.error);
  otbId = o.data.id;
});

afterEach(async () => { await client.close(); });

describe("ruang lingkup", () => {
  it("riwayat OTB mencakup peristiwa pada PORT-nya, bukan hanya barisnya sendiri", async () => {
    await ubahPort(otbId, 1, 5, { status: "terpakai" }, "u1");
    await ubahPort(otbId, 1, 6, { status: "rusak" }, "u1");

    const h = await riwayatTopologi({ jenis: "otb", id: otbId });
    const jenis = h.baris.map((b) => b.entityType);
    expect(jenis).toContain("otb");
    expect(jenis.filter((j) => j === "otb_port")).toHaveLength(2);
    // Kalau ruang lingkupnya tidak dikembangkan, ini cuma 1.
    expect(h.baris.length).toBe(3);
  });

  it("riwayat OTB mencakup perubahan kapasitas TRAY-nya", async () => {
    await aturKapasitasTray(otbId, 2, 12, "u1");
    const h = await riwayatTopologi({ jenis: "otb", id: otbId });
    expect(h.baris.some((b) => b.entityType === "otb_tray")).toBe(true);
  });

  it("riwayat kabel mencakup terminasi core-nya", async () => {
    const k = await buatKabel({ code: "KBL-1", category: "feeder", coreCount: 4 }, "u1");
    if (!k.ok) throw new Error(k.error);
    const cores = (await detailKabel(k.data.id))!.cores;
    const [port] = await d().select().from(schema.otbPorts).limit(1);
    await terminasiCore({ coreId: cores[0].id, coreEnd: "A", otbPortId: port.id, reason: "x" }, "u1");

    const h = await riwayatTopologi({ jenis: "fiber_cable", id: k.data.id });
    const jenis = h.baris.map((b) => b.entityType);
    expect(jenis).toContain("fiber_cable");
    expect(jenis).toContain("fiber_termination");
  });

  it("riwayat satu OTB tidak membawa peristiwa OTB lain", async () => {
    const lain = await buatOtb(
      { code: "OTB-2", name: "OTB Dua", connectorType: "LC", trayCount: 1,
        latitude: -8.45, longitude: 115.6 }, "u1");
    if (!lain.ok) throw new Error(lain.error);
    await ubahPort(lain.data.id, 1, 1, { status: "terpakai" }, "u1");

    const h = await riwayatTopologi({ jenis: "otb", id: otbId });
    expect(h.baris).toHaveLength(1);
    expect(h.baris[0].entityType).toBe("otb");
  });
});

describe("kalimat dan pelaku", () => {
  it("action diterjemahkan jadi kalimat, dan pelakunya bernama", async () => {
    const h = await riwayatTopologi({ jenis: "otb", id: otbId });
    expect(h.baris[0]).toMatchObject({ action: "otb.created", ringkas: "OTB dibuat", oleh: "Penguji" });
  });

  it("aksi tak dikenal TIDAK disembunyikan — riwayat yang membuang peristiwa terlihat lengkap", async () => {
    await d().insert(schema.auditLogs).values({
      id: "aneh", actorUserId: null, actorLabel: "system",
      action: "otb.sesuatu.yang.belum.ada", entityType: "otb", entityId: otbId,
      detail: null, createdAt: new Date(),
    });
    const h = await riwayatTopologi({ jenis: "otb", id: otbId });
    const baris = h.baris.find((b) => b.id === "aneh")!;
    expect(baris).toBeDefined();
    expect(baris.ringkas).toBe("otb.sesuatu.yang.belum.ada");
    expect(baris.oleh).toBe("sistem");
  });

  it("detail sebelum/sesudah ikut terbawa", async () => {
    await ubahPort(otbId, 1, 3, { status: "terpakai" }, "u1");
    const h = await riwayatTopologi({ jenis: "otb", id: otbId });
    const port = h.baris.find((b) => b.entityType === "otb_port")!;
    expect((port.detail as { sebelum: { status: string } }).sebelum.status).toBe("kosong");
  });
});

describe("halaman", () => {
  it("penanda memakai waktu DAN id — baris dengan waktu sama tidak hilang", async () => {
    // Satu milidetik yang sama untuk sepuluh baris: persis yang terjadi pada
    // pemasangan silangan massal.
    const sama = new Date("2026-08-22T03:00:00.000Z");
    await d().insert(schema.auditLogs).values(
      Array.from({ length: 10 }, (_, i) => ({
        id: `bersamaan-${String(i).padStart(2, "0")}`,
        actorUserId: null, actorLabel: "system",
        action: "fiber.splice.created", entityType: "fiber_splice",
        entityId: `sp${i}`, detail: null, createdAt: sama,
      })),
    );

    const terkumpul: string[] = [];
    let sesudah: string | null = null;
    for (let putaran = 0; putaran < 10; putaran += 1) {
      const h: Awaited<ReturnType<typeof riwayatTopologi>> =
        await riwayatTopologi({ limit: 3, sesudah });
      terkumpul.push(...h.baris.map((b) => b.id));
      sesudah = h.berikutnya;
      if (!sesudah) break;
    }
    const sepuluh = terkumpul.filter((id) => id.startsWith("bersamaan-"));
    expect(sepuluh).toHaveLength(10);
    expect(new Set(sepuluh).size).toBe(10);
  });

  it("berikutnya null saat sudah habis", async () => {
    const h = await riwayatTopologi({ limit: 100 });
    expect(h.berikutnya).toBeNull();
  });
});

describe("rute", () => {
  async function panggil(qs: string) {
    const res = await GET(new Request(`http://localhost/api/v1/ftth/riwayat${qs}`), undefined);
    return { status: res.status, body: await res.json() };
  }

  it("jenis tanpa id ditolak, dan sebaliknya", async () => {
    expect((await panggil("?jenis=otb")).status).toBe(400);
    expect((await panggil("?id=x")).status).toBe(400);
  });

  it("jenis yang tidak dikenal ditolak, bukan diabaikan", async () => {
    const { status, body } = await panggil("?jenis=ngawur&id=x");
    expect(status).toBe(400);
    expect(body.error).toMatch(/otb/);
  });

  it("limit di luar 1–100 ditolak", async () => {
    for (const n of [0, 101, 5000]) {
      expect((await panggil(`?limit=${n}`)).status).toBe(400);
    }
  });

  it("tanpa saringan mengembalikan riwayat seluruh topologi", async () => {
    const { status, body } = await panggil("");
    expect(status).toBe(200);
    expect(body.baris.length).toBeGreaterThan(0);
  });
});
