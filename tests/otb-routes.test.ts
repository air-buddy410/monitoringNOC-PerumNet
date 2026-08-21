// OTB, tray, dan port — rute dan lapisan domainnya (Fase 11).
//
// Tiga hal yang dijaga di sini, dan ketiganya gagal tanpa terlihat:
//
//   1. Nomor global port. Layar menyebutnya "Core 17". Kalau ia dihitung
//      ulang dari kapasitas alih-alih disimpan, menambah satu port di tray 1
//      menggeser nomor seluruh tray sesudahnya — dan setiap label yang sudah
//      tertempel di lapangan seketika menunjuk port yang salah.
//   2. Transaksi pembuatan. `POST /api/v1/ftth/odps` yang ada lebih dulu
//      membuat ODP lalu port-nya di luar transaksi; kalau insert port gagal,
//      ODP tanpa port tertinggal tanpa ada yang tahu. Tes di bawah menolak
//      cacat itu disalin ke sini.
//   3. Baris audit pada perubahan port. Ia bukan hiasan — aturan penurunan
//      kapasitas membacanya untuk tahu port mana yang pernah disentuh.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  role: "admin" as string,
}));

vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/server/rbac", () => ({
  withRole:
    (_roles: string[], handler: (r: Request, u: unknown, c: unknown) => Promise<Response>) =>
    (request: Request, context: unknown) =>
      handler(
        request,
        { id: "u1", name: "Penguji", email: "uji@contoh.id", role: mocks.role },
        context,
      ),
}));

import * as schema from "@/db/schema";
import * as authSchema from "@/db/auth-schema";
import { GET as DAFTAR, POST as BUAT } from "@/app/api/v1/ftth/otb/route";
import { GET as DETAIL } from "@/app/api/v1/ftth/otb/[otbId]/route";
import {
  GET as PORT_TRAY,
  PATCH as UBAH_PORT,
} from "@/app/api/v1/ftth/otb/[otbId]/trays/[trayNumber]/ports/route";

const MIGRATION_DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const migrationSql = readdirSync(MIGRATION_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATION_DIR, f), "utf8"))
  .join("\n");

let client: PGlite;

function ctx(otbId: string, trayNumber?: number) {
  return { params: Promise.resolve({ otbId, trayNumber: String(trayNumber ?? 1) }) };
}

async function buat(body: Record<string, unknown>) {
  return BUAT(
    new Request("http://localhost/api/v1/ftth/otb", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    undefined,
  );
}

beforeEach(async () => {
  client = new PGlite();
  await client.exec(migrationSql);
  mocks.db = drizzle(client, { schema: { ...schema, ...authSchema } });
  mocks.role = "admin";
  const db = mocks.db as ReturnType<typeof drizzle>;
  await db.insert(schema.networkSites).values({ id: "s1", code: "KCC", name: "Kecicang" });
  await db.insert(authSchema.user).values({
    id: "u1", name: "Penguji", email: "uji@contoh.id",
    emailVerified: true, createdAt: new Date(), updatedAt: new Date(),
  });
});

afterEach(async () => {
  await client.close();
});

describe("POST /api/v1/ftth/otb", () => {
  it("membuat tray dan port persis sebanyak yang diminta, nomor global 1..N tanpa lubang", async () => {
    const res = await buat({ code: "otb-kcc-01", name: "OTB POP Kecicang", siteId: "s1", connectorType: "SC", trayCount: 8 });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.code).toBe("OTB-KCC-01");
    expect(body.portCount).toBe(96);

    const db = mocks.db as ReturnType<typeof drizzle>;
    const trays = await db.select().from(schema.otbTrays);
    const ports = await db.select().from(schema.otbPorts);
    expect(trays).toHaveLength(8);
    expect(ports).toHaveLength(96);

    // Nomor global menyeluruh se-OTB, bukan diulang per tray. Implementasi
    // yang me-reset penomoran tiap tray menghasilkan delapan kali 1..12.
    const global = ports.map((p) => p.globalPortNumber).sort((a, b) => a - b);
    expect(global).toEqual(Array.from({ length: 96 }, (_, i) => i + 1));

    // Sementara nomor DALAM tray memang berulang 1..12 di tiap tray.
    for (const t of trays) {
      const isi = ports
        .filter((p) => p.trayId === t.id)
        .map((p) => p.portNumberInTray)
        .sort((a, b) => a - b);
      expect(isi).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    }
  });

  it("kapasitas bawaan mengikuti konektor: SC 12, LC 24", async () => {
    await buat({ code: "SC-1", name: "SC Satu", siteId: "s1", connectorType: "SC", trayCount: 1 });
    await buat({ code: "LC-1", name: "LC Satu", siteId: "s1", connectorType: "LC", trayCount: 1 });
    const db = mocks.db as ReturnType<typeof drizzle>;
    const semua = await db.select().from(schema.otbPorts);
    const perOtb = await db.select().from(schema.otb);
    const sc = perOtb.find((o) => o.code === "SC-1")!;
    const lc = perOtb.find((o) => o.code === "LC-1")!;
    expect(semua.filter((p) => p.otbId === sc.id)).toHaveLength(12);
    expect(semua.filter((p) => p.otbId === lc.id)).toHaveLength(24);
  });

  it("12/24 itu DEFAULT, bukan batas keras — kapasitas lain diterima", async () => {
    // Menggagalkan implementasi yang memakai Math.min atau menolak angka
    // di luar 12/24. PRD FR-OTB-002 eksplisit soal ini.
    const res = await buat({ code: "SC-30", name: "SC Tiga Puluh", siteId: "s1", connectorType: "SC", trayCount: 1, portsPerTray: 30 });
    expect(res.status).toBe(201);
    expect((await res.json()).portCount).toBe(30);
  });

  it("OTB tanpa situs dan tanpa koordinat ditolak — ia tak akan pernah muncul di peta", async () => {
    const res = await buat({ code: "X-1", name: "Tanpa Lokasi", trayCount: 1 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/latitude dan longitude/);

    const db = mocks.db as ReturnType<typeof drizzle>;
    expect(await db.select().from(schema.otb)).toHaveLength(0);
  });

  it("OTB tanpa situs TAPI berkoordinat diterima — itu OTB tiang", async () => {
    const res = await buat({ code: "TIANG-1", name: "OTB Tiang", trayCount: 1, latitude: -8.45, longitude: 115.6 });
    expect(res.status).toBe(201);
  });

  it("kode ganda ditolak 409 dan menyebut kodenya", async () => {
    await buat({ code: "DUP", name: "Pertama", siteId: "s1", trayCount: 1 });
    const res = await buat({ code: "dup", name: "Kedua", siteId: "s1", trayCount: 1 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("DUP");
  });

  it("trayCount di luar 1–64 ditolak", async () => {
    for (const trayCount of [0, 65, 1.5]) {
      const res = await buat({ code: `T${trayCount}`, name: "x", siteId: "s1", trayCount });
      expect(res.status).toBe(400);
    }
  });

  it("kegagalan di tengah tidak meninggalkan OTB yatim", async () => {
    // Inilah tes yang menolak penyalinan pola POST /ftth/odps yang
    // non-transaksional. Insert ketiga (port) sengaja digagalkan; kalau
    // handler tidak memakai db.transaction, baris `otb` akan tertinggal.
    const db = mocks.db as ReturnType<typeof drizzle> & { transaction: unknown };
    const asli = (db.transaction as (...a: unknown[]) => unknown).bind(db);
    (db as { transaction: unknown }).transaction = (fn: (tx: unknown) => unknown) =>
      asli(async (tx: { insert: (t: unknown) => unknown }) => {
        const insertAsli = tx.insert.bind(tx);
        let n = 0;
        tx.insert = (tabel: unknown) => {
          n += 1;
          if (n === 3) throw new Error("gagal buatan pada insert port");
          return insertAsli(tabel);
        };
        return fn(tx);
      });

    await expect(
      buat({ code: "ROLLBACK", name: "Uji Rollback", siteId: "s1", trayCount: 2 }),
    ).rejects.toThrow(/gagal buatan/);

    (db as { transaction: unknown }).transaction = asli;
    expect(await db.select().from(schema.otb)).toHaveLength(0);
    expect(await db.select().from(schema.otbTrays)).toHaveLength(0);
    expect(await db.select().from(schema.auditLogs)).toHaveLength(0);
  });

  it("menulis satu baris audit, bukan satu per port", async () => {
    await buat({ code: "AUD", name: "Audit", siteId: "s1", connectorType: "LC", trayCount: 4 });
    const db = mocks.db as ReturnType<typeof drizzle>;
    const audit = await db.select().from(schema.auditLogs);
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("otb.created");
    expect(audit[0].entityType).toBe("otb");
    expect(audit[0].actorUserId).toBe("u1");
  });
});

describe("GET /api/v1/ftth/otb", () => {
  it("jumlah terpakai diturunkan dari baris port, bukan kolom tersimpan", async () => {
    const buatRes = await buat({ code: "A", name: "A", siteId: "s1", connectorType: "LC", trayCount: 2 });
    const { id } = await buatRes.json();

    let res = await DAFTAR(new Request("http://localhost/api/v1/ftth/otb"), undefined);
    let body = await res.json();
    expect(body.otb[0]).toMatchObject({ trayCount: 2, portCount: 48, usedPorts: 0, siteName: "Kecicang" });

    await UBAH_PORT(
      new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ portNumberInTray: 5, status: "terpakai" }) }),
      ctx(id, 1),
    );

    res = await DAFTAR(new Request("http://localhost/api/v1/ftth/otb"), undefined);
    body = await res.json();
    expect(body.otb[0].usedPorts).toBe(1);
    expect(body.otb[0].portCount).toBe(48);
  });
});

describe("GET /api/v1/ftth/otb/:otbId", () => {
  it("lencana tray diturunkan dari isi port-nya", async () => {
    const { id } = await (await buat({ code: "B", name: "B", siteId: "s1", connectorType: "SC", trayCount: 3 })).json();
    const db = mocks.db as ReturnType<typeof drizzle>;
    const trays = await db.select().from(schema.otbTrays).orderBy(schema.otbTrays.trayNumber);

    // Tray 1 penuh, tray 2 sebagian, tray 3 dibiarkan kosong.
    await db.update(schema.otbPorts).set({ status: "terpakai" }).where(eq(schema.otbPorts.trayId, trays[0].id));
    await db.update(schema.otbPorts).set({ status: "terpakai" })
      .where(eq(schema.otbPorts.id,
        (await db.select().from(schema.otbPorts).where(eq(schema.otbPorts.trayId, trays[1].id)))[0].id));
    await db.update(schema.otbTrays).set({ status: "nonaktif" }).where(eq(schema.otbTrays.id, trays[2].id));

    const res = await DETAIL(new Request("http://localhost/x"), ctx(id));
    const body = await res.json();
    expect(body.trays.map((t: { status: string }) => t.status)).toEqual(["terhubung", "sebagian", "nonaktif"]);
    expect(body.trays[0]).toMatchObject({ connectorType: "SC", polish: "APC", portCount: 12, usedPorts: 12 });
  });

  it("OTB yang tidak ada → 404", async () => {
    const res = await DETAIL(new Request("http://localhost/x"), ctx("entah"));
    expect(res.status).toBe(404);
  });
});

describe("port satu tray", () => {
  it("hanya port tray yang diminta, urut nomor dalam tray", async () => {
    const { id } = await (await buat({ code: "C", name: "C", siteId: "s1", connectorType: "SC", trayCount: 3 })).json();
    const res = await PORT_TRAY(new Request("http://localhost/x"), ctx(id, 2));
    const { ports } = await res.json();
    expect(ports).toHaveLength(12);
    expect(ports.map((p: { portNumberInTray: number }) => p.portNumberInTray)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    // Tray 2 dari OTB SC 12-port: nomor globalnya 13..24.
    expect(ports.map((p: { globalPortNumber: number }) => p.globalPortNumber)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 13),
    );
  });

  it("tray yang tidak ada → 404, bukan daftar kosong", async () => {
    const { id } = await (await buat({ code: "D", name: "D", siteId: "s1", trayCount: 1 })).json();
    const res = await PORT_TRAY(new Request("http://localhost/x"), ctx(id, 99));
    expect(res.status).toBe(404);
  });

  it("nomor tray bukan angka → 400", async () => {
    const { id } = await (await buat({ code: "E", name: "E", siteId: "s1", trayCount: 1 })).json();
    const res = await PORT_TRAY(new Request("http://localhost/x"), {
      params: Promise.resolve({ otbId: id, trayNumber: "abc" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("PATCH port", () => {
  async function siapkan() {
    const { id } = await (await buat({ code: "P", name: "P", siteId: "s1", connectorType: "LC", trayCount: 2 })).json();
    return id as string;
  }

  it("mengubah status dan meninggalkan jejak audit per port", async () => {
    const id = await siapkan();
    const res = await UBAH_PORT(
      new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ portNumberInTray: 7, status: "terpakai", externalServiceId: "SRV-1" }) }),
      ctx(id, 1),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ portNumberInTray: 7, status: "terpakai" });

    const db = mocks.db as ReturnType<typeof drizzle>;
    const audit = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityType, "otb_port"));
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("otb.port.updated");
    // Sebelum/sesudah, supaya audit bisa menjawab "apa yang berubah".
    expect((audit[0].detail as { sebelum: { status: string } }).sebelum.status).toBe("kosong");
  });

  it("status yang tidak dikenal ditolak — kolomnya text dan akan menerimanya", async () => {
    const id = await siapkan();
    const res = await UBAH_PORT(
      new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ portNumberInTray: 1, status: "terpaki" }) }),
      ctx(id, 1),
    );
    expect(res.status).toBe(400);
    const db = mocks.db as ReturnType<typeof drizzle>;
    expect(await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityType, "otb_port"))).toHaveLength(0);
  });

  it("OTB nonaktif menolak perubahan port", async () => {
    const id = await siapkan();
    const db = mocks.db as ReturnType<typeof drizzle>;
    await db.update(schema.otb).set({ status: "nonaktif" }).where(eq(schema.otb.id, id));
    const res = await UBAH_PORT(
      new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ portNumberInTray: 1, status: "terpakai" }) }),
      ctx(id, 1),
    );
    expect(res.status).toBe(409);
  });

  it("port di luar tray yang disebut tidak bisa disentuh", async () => {
    const id = await siapkan();
    const res = await UBAH_PORT(
      new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ portNumberInTray: 99, status: "terpakai" }) }),
      ctx(id, 1),
    );
    expect(res.status).toBe(404);
  });

  it("dua OTB boleh sama-sama punya port global 17", async () => {
    // Menggagalkan unique global pada global_port_number saja. "Core 17"
    // unik PER OTB, bukan se-jaringan.
    await buat({ code: "G1", name: "G1", siteId: "s1", connectorType: "LC", trayCount: 1 });
    const res = await buat({ code: "G2", name: "G2", siteId: "s1", connectorType: "LC", trayCount: 1 });
    expect(res.status).toBe(201);
    const db = mocks.db as ReturnType<typeof drizzle>;
    const tujuhBelas = (await db.select().from(schema.otbPorts)).filter((p) => p.globalPortNumber === 17);
    expect(tujuhBelas).toHaveLength(2);
  });
});
