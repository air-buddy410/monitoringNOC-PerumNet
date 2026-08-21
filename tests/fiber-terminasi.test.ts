// Kabel, core, dan terminasi (Fase 12).
//
// Yang benar-benar dijaga di sini adalah OKUPANSI, dan bukan oleh kode.
// Tiga partial unique index di `fiber_core_terminations` yang menjamin satu
// ujung core dan satu port hanya punya satu terminasi aktif. Pemeriksaan di
// `fiber-store.ts` cuma ada supaya pesannya bisa dibaca manusia — kalau dua
// operator menekan simpan pada milidetik yang sama, yang menolak hanya bisa
// database. Karena itu ada tes yang menulis LANGSUNG ke tabel, melewati store
// sepenuhnya: kalau tes itu hijau padahal index-nya dihapus, ia tidak menguji
// apa pun.
//
// Satu tes menyeberang ke Fase 11 dengan sengaja: port yang pernah membawa
// core lalu dilepas harus tetap menahan penurunan kapasitas tray. Itu satu-
// satunya cara membuktikan kedua fase benar-benar tersambung.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, isNull } from "drizzle-orm";
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
import { buatOtb, aturKapasitasTray } from "@/server/otb-store";
import {
  buatKabel,
  detailKabel,
  lepasTerminasi,
  riwayatTerminasiCore,
  terminasiCore,
  ubahOtb,
  warnaCore,
} from "@/server/fiber-store";

const MIGRATION_DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const migrationSql = readdirSync(MIGRATION_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATION_DIR, f), "utf8"))
  .join("\n");

let client: PGlite;
let otbId: string;
let portOtb: { id: string; globalPortNumber: number }[];
let odpPortId: string;
let msPortId: string;

function d() {
  return mocks.db as ReturnType<typeof drizzle>;
}

async function kabel(kode: string, kategori: "feeder" | "distribution", jumlah = 4) {
  const h = await buatKabel(
    { code: kode, category: kategori, coreCount: jumlah },
    "u1",
  );
  if (!h.ok) throw new Error(h.error);
  const detail = await detailKabel(h.data.id);
  return { id: h.data.id, cores: detail!.cores };
}

beforeEach(async () => {
  client = new PGlite();
  await client.exec(migrationSql);
  mocks.db = drizzle(client, { schema: { ...schema, ...authSchema } });

  await d().insert(schema.networkSites).values({ id: "s1", code: "KCC", name: "Kecicang" });
  await d().insert(authSchema.user).values({
    id: "u1", name: "P", email: "p@c.id",
    emailVerified: true, createdAt: new Date(), updatedAt: new Date(),
  });

  const h = await buatOtb(
    { code: "OTB-1", name: "OTB Satu", siteId: "s1", connectorType: "LC", trayCount: 2 },
    "u1",
  );
  if (!h.ok) throw new Error(h.error);
  otbId = h.data.id;
  portOtb = await d()
    .select({ id: schema.otbPorts.id, globalPortNumber: schema.otbPorts.globalPortNumber })
    .from(schema.otbPorts)
    .orderBy(schema.otbPorts.globalPortNumber);

  // Satu ODP biasa dan satu master splitter — MS memang `odps` berperan MS.
  await d().insert(schema.odps).values([
    { id: "odp1", code: "ODP-1", name: "ODP Satu", role: "ODP", capacity: 8 },
    { id: "ms1", code: "MS-1", name: "MS Satu", role: "MS", capacity: 8 },
  ]);
  await d().insert(schema.odpPorts).values([
    { id: "op1", odpId: "odp1", portNumber: 1 },
    { id: "mp1", odpId: "ms1", portNumber: 1 },
  ]);
  odpPortId = "op1";
  msPortId = "mp1";
});

afterEach(async () => {
  await client.close();
});

describe("membuat kabel", () => {
  it("core dibuat sebanyak coreCount, berwarna urutan standar", async () => {
    const { cores } = await kabel("KBL-1", "feeder", 14);
    expect(cores).toHaveLength(14);
    expect(cores.map((c) => c.coreNumber)).toEqual(
      Array.from({ length: 14 }, (_, i) => i + 1),
    );
    expect(cores[0].color).toBe("biru");
    expect(cores[11].color).toBe("tosca");
    // Ke-13 mengulang; pembedanya tabung, bukan warna.
    expect(cores[12].color).toBe("biru");
    expect(warnaCore(25)).toBe("biru");
  });

  it("peruntukan core mengikuti kategori kabel kalau tidak disebut", async () => {
    const feeder = await kabel("KBL-F", "feeder", 2);
    const distribusi = await kabel("KBL-D", "distribution", 2);
    expect(feeder.cores.every((c) => c.purpose === "feeder")).toBe(true);
    expect(distribusi.cores.every((c) => c.purpose === "distribution")).toBe(true);
  });

  it("lengthM boleh kosong — belum diukur bukan nol", async () => {
    const h = await buatKabel({ code: "KBL-N", category: "feeder", coreCount: 1 }, "u1");
    expect(h.ok).toBe(true);
    const [row] = await d().select().from(schema.fiberCableSegments)
      .where(eq(schema.fiberCableSegments.code, "KBL-N"));
    expect(row.lengthM).toBeNull();
  });

  it("kode ganda ditolak, dan tidak meninggalkan kabel yatim", async () => {
    await kabel("KBL-X", "feeder", 2);
    const h = await buatKabel({ code: "kbl-x", category: "feeder", coreCount: 2 }, "u1");
    expect(h.ok).toBe(false);
    expect(await d().select().from(schema.fiberCableSegments)).toHaveLength(1);
  });
});

describe("terminasi core", () => {
  it("menempelkan core ke port OTB dan menandai portnya terpakai", async () => {
    const { cores } = await kabel("KBL-1", "feeder");
    const h = await terminasiCore(
      { coreId: cores[0].id, coreEnd: "A", otbPortId: portOtb[0].id, reason: "instalasi baru" },
      "u1",
    );
    expect(h.ok).toBe(true);

    const [port] = await d().select().from(schema.otbPorts)
      .where(eq(schema.otbPorts.id, portOtb[0].id));
    expect(port.status).toBe("terpakai");

    // DUA baris audit: satu untuk terminasinya, satu untuk PORT-nya. Yang
    // kedua yang menjaga aturan kapasitas Fase 11 tetap bekerja.
    const audit = await d().select().from(schema.auditLogs);
    expect(audit.filter((a) => a.entityType === "fiber_termination")).toHaveLength(1);
    expect(audit.filter((a) => a.entityType === "otb_port")).toHaveLength(1);
  });

  it("ujung yang sama tidak bisa diterminasi dua kali", async () => {
    const { cores } = await kabel("KBL-1", "feeder");
    await terminasiCore(
      { coreId: cores[0].id, coreEnd: "A", otbPortId: portOtb[0].id, reason: "satu" },
      "u1",
    );
    const h = await terminasiCore(
      { coreId: cores[0].id, coreEnd: "A", otbPortId: portOtb[1].id, reason: "dua" },
      "u1",
    );
    expect(h.ok).toBe(false);
  });

  it("ujung B core yang sama boleh — satu core punya dua ujung", async () => {
    const { cores } = await kabel("KBL-1", "feeder");
    await terminasiCore(
      { coreId: cores[0].id, coreEnd: "A", otbPortId: portOtb[0].id, reason: "A" },
      "u1",
    );
    const h = await terminasiCore(
      { coreId: cores[0].id, coreEnd: "B", otbPortId: portOtb[1].id, reason: "B" },
      "u1",
    );
    expect(h.ok).toBe(true);
  });

  it("port yang sudah terpakai menolak core lain", async () => {
    const { cores } = await kabel("KBL-1", "feeder");
    await terminasiCore(
      { coreId: cores[0].id, coreEnd: "A", otbPortId: portOtb[0].id, reason: "satu" },
      "u1",
    );
    const h = await terminasiCore(
      { coreId: cores[1].id, coreEnd: "A", otbPortId: portOtb[0].id, reason: "dua" },
      "u1",
    );
    expect(h.ok).toBe(false);
    if (!h.ok) expect(h.error).toMatch(/terpakai/);
  });

  it("core feeder ditolak di port ODP — ODP hanya menerima distribution", async () => {
    // PRD §3 aturan 1. Core feeder yang berakhir di ODP berarti jalurnya
    // salah gambar, bukan sekadar salah label.
    const { cores } = await kabel("KBL-F", "feeder");
    const h = await terminasiCore(
      { coreId: cores[0].id, coreEnd: "A", odpPortId: odpPortId, reason: "salah" },
      "u1",
    );
    expect(h.ok).toBe(false);
    if (!h.ok) {
      expect(h.status).toBe(409);
      expect(h.error).toMatch(/distribution/);
    }
  });

  it("core distribution diterima di port ODP", async () => {
    const { cores } = await kabel("KBL-D", "distribution");
    const h = await terminasiCore(
      { coreId: cores[0].id, coreEnd: "A", odpPortId: odpPortId, reason: "sambung pelanggan" },
      "u1",
    );
    expect(h.ok).toBe(true);
  });

  it("core feeder BOLEH di port master splitter — MS bukan ODP", async () => {
    // `odps.role = 'MS'` adalah master splitter; input feedernya memang core
    // feeder. Aturan distribution hanya berlaku untuk role ODP.
    const { cores } = await kabel("KBL-F", "feeder");
    const h = await terminasiCore(
      { coreId: cores[0].id, coreEnd: "A", odpPortId: msPortId, reason: "feeder ke MS" },
      "u1",
    );
    expect(h.ok).toBe(true);
  });

  it("dua sasaran sekaligus, atau tidak sama sekali, ditolak", async () => {
    const { cores } = await kabel("KBL-1", "feeder");
    for (const sasaran of [
      { otbPortId: portOtb[0].id, odpPortId },
      {},
    ]) {
      const h = await terminasiCore(
        { coreId: cores[0].id, coreEnd: "A", reason: "x", ...sasaran },
        "u1",
      );
      expect(h.ok).toBe(false);
      if (!h.ok) expect(h.status).toBe(400);
    }
  });

  it("alasan wajib — mutasi topologi tanpa alasan tidak bisa ditelusuri", async () => {
    const { cores } = await kabel("KBL-1", "feeder");
    const h = await terminasiCore(
      { coreId: cores[0].id, coreEnd: "A", otbPortId: portOtb[0].id, reason: "   " },
      "u1",
    );
    expect(h.ok).toBe(false);
    if (!h.ok) expect(h.status).toBe(400);
  });

  it("core rusak tidak bisa diterminasi", async () => {
    const { cores } = await kabel("KBL-1", "feeder");
    await d().update(schema.fiberCores).set({ status: "rusak" })
      .where(eq(schema.fiberCores.id, cores[0].id));
    const h = await terminasiCore(
      { coreId: cores[0].id, coreEnd: "A", otbPortId: portOtb[0].id, reason: "x" },
      "u1",
    );
    expect(h.ok).toBe(false);
  });
});

describe("okupansi ditegakkan DATABASE, bukan kode", () => {
  it("insert langsung yang menduakan ujung core ditolak index", async () => {
    // Melewati store sepenuhnya. Kalau partial unique index dihapus, tes ini
    // hijau dan seluruh jaminan okupansi hilang tanpa ada yang merah.
    const { cores } = await kabel("KBL-1", "feeder");
    await d().insert(schema.fiberCoreTerminations).values({
      id: "t1", coreId: cores[0].id, coreEnd: "A",
      otbPortId: portOtb[0].id, reason: "pertama",
    });
    await expect(
      d().insert(schema.fiberCoreTerminations).values({
        id: "t2", coreId: cores[0].id, coreEnd: "A",
        otbPortId: portOtb[1].id, reason: "kedua",
      }),
    ).rejects.toThrow();
  });

  it("insert langsung yang menduakan port OTB ditolak index", async () => {
    const { cores } = await kabel("KBL-1", "feeder");
    await d().insert(schema.fiberCoreTerminations).values({
      id: "t1", coreId: cores[0].id, coreEnd: "A",
      otbPortId: portOtb[0].id, reason: "pertama",
    });
    await expect(
      d().insert(schema.fiberCoreTerminations).values({
        id: "t2", coreId: cores[1].id, coreEnd: "A",
        otbPortId: portOtb[0].id, reason: "kedua",
      }),
    ).rejects.toThrow();
  });

  it("terminasi tanpa sasaran ditolak CHECK", async () => {
    const { cores } = await kabel("KBL-1", "feeder");
    await expect(
      d().insert(schema.fiberCoreTerminations).values({
        id: "t1", coreId: cores[0].id, coreEnd: "A", reason: "menempel di mana?",
      }),
    ).rejects.toThrow();
  });

  it("terminasi dengan DUA sasaran ditolak CHECK", async () => {
    const { cores } = await kabel("KBL-1", "distribution");
    await expect(
      d().insert(schema.fiberCoreTerminations).values({
        id: "t1", coreId: cores[0].id, coreEnd: "A",
        otbPortId: portOtb[0].id, odpPortId, reason: "dua-duanya",
      }),
    ).rejects.toThrow();
  });

  it("port yang masih membawa core tidak bisa dihapus — FK restrict", async () => {
    // Inilah yang membuat aturan kapasitas Fase 11 tetap benar tanpa satu
    // baris pun diubah di sana.
    const { cores } = await kabel("KBL-1", "feeder");
    await terminasiCore(
      { coreId: cores[0].id, coreEnd: "A", otbPortId: portOtb[0].id, reason: "x" },
      "u1",
    );
    await expect(
      d().delete(schema.otbPorts).where(eq(schema.otbPorts.id, portOtb[0].id)),
    ).rejects.toThrow();
  });
});

describe("melepas terminasi", () => {
  async function pasang(indexPort = 0) {
    const { cores } = await kabel("KBL-1", "feeder");
    const h = await terminasiCore(
      { coreId: cores[0].id, coreEnd: "A", otbPortId: portOtb[indexPort].id, reason: "instalasi" },
      "u1",
    );
    if (!h.ok) throw new Error(h.error);
    return { terminationId: h.data.id, coreId: cores[0].id, coreLain: cores[1].id };
  }

  it("barisnya TIDAK dihapus, dan portnya kembali kosong", async () => {
    const { terminationId, coreId } = await pasang();
    const h = await lepasTerminasi(terminationId, "kabel diganti", "u1");
    expect(h.ok).toBe(true);

    const riwayat = await riwayatTerminasiCore(coreId);
    expect(riwayat).toHaveLength(1);
    expect(riwayat[0].deactivatedAt).not.toBeNull();
    expect(riwayat[0].deactivatedReason).toBe("kabel diganti");

    const [port] = await d().select().from(schema.otbPorts)
      .where(eq(schema.otbPorts.id, portOtb[0].id));
    expect(port.status).toBe("kosong");
  });

  it("port yang sudah dilepas bisa dipakai core lain — index-nya parsial", async () => {
    const { terminationId, coreLain } = await pasang();
    await lepasTerminasi(terminationId, "reroute", "u1");
    const h = await terminasiCore(
      { coreId: coreLain, coreEnd: "A", otbPortId: portOtb[0].id, reason: "core pengganti" },
      "u1",
    );
    expect(h.ok).toBe(true);

    // Dua baris: yang lama non-aktif, yang baru aktif.
    const semua = await d().select().from(schema.fiberCoreTerminations);
    expect(semua).toHaveLength(2);
    const aktif = await d().select().from(schema.fiberCoreTerminations)
      .where(isNull(schema.fiberCoreTerminations.deactivatedAt));
    expect(aktif).toHaveLength(1);
  });

  it("melepas dua kali ditolak", async () => {
    const { terminationId } = await pasang();
    await lepasTerminasi(terminationId, "sekali", "u1");
    const h = await lepasTerminasi(terminationId, "dua kali", "u1");
    expect(h.ok).toBe(false);
  });

  it("port yang PERNAH membawa core tetap menahan penurunan kapasitas", async () => {
    // Menyeberang ke Fase 11 dengan sengaja. Setelah dilepas, portnya kembali
    // `kosong` — persis sama dengan port yang belum pernah dipakai. Yang
    // membedakan hanya baris audit `otb_port`, dan aturan kapasitas
    // membacanya.
    // Port ke-6 (dalam tray 1), supaya ia benar-benar termasuk yang hilang
    // saat tray dikecilkan jadi 3 port.
    const { terminationId } = await pasang(5);
    await lepasTerminasi(terminationId, "dibongkar", "u1");

    const [port] = await d().select().from(schema.otbPorts)
      .where(eq(schema.otbPorts.id, portOtb[5].id));
    expect(port.status).toBe("kosong");

    const h = await aturKapasitasTray(otbId, 1, 3, "u1");
    expect(h.ok).toBe(false);
    if (!h.ok) expect(h.error).toMatch(/riwayat/);
  });
});

describe("PATCH OTB", () => {
  it("mengubah nama dan status, dengan audit sebelum/sesudah", async () => {
    const h = await ubahOtb(otbId, { name: "OTB Baru", status: "nonaktif" }, "u1");
    expect(h.ok).toBe(true);
    const [row] = await d().select().from(schema.otb).where(eq(schema.otb.id, otbId));
    expect(row.name).toBe("OTB Baru");
    expect(row.status).toBe("nonaktif");

    const audit = await d().select().from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.entityType, "otb"), eq(schema.auditLogs.action, "otb.updated")));
    expect(audit).toHaveLength(1);
    expect((audit[0].detail as { sebelum: { name: string } }).sebelum.name).toBe("OTB Satu");
  });

  it("melepas situs tanpa memberi koordinat ditolak", async () => {
    // Kalau lolos, OTB-nya hilang dari peta tanpa pesan apa pun.
    const h = await ubahOtb(otbId, { siteId: null }, "u1");
    expect(h.ok).toBe(false);
    if (!h.ok) expect(h.status).toBe(400);
  });

  it("melepas situs SAMBIL memberi koordinat diterima", async () => {
    const h = await ubahOtb(
      otbId,
      { siteId: null, latitude: -8.45, longitude: 115.6 },
      "u1",
    );
    expect(h.ok).toBe(true);
  });
});
