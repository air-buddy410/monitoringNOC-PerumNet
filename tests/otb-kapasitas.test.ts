// Penurunan dan penambahan kapasitas tray (PRD FR-OTB-003).
//
// Aturannya: port yang akan hilang boleh dilepas hanya kalau ia bersih
// SEKARANG dan belum pernah disentuh manusia. Syarat kedua itu yang penting,
// dan yang paling mudah lupa: port yang pernah terpakai lalu dibebaskan
// terlihat identik dengan port yang belum pernah dipakai — bedanya hanya
// jejak di `audit_logs`. Implementasi yang cuma melihat `status` akan lolos
// semua tes kecuali satu di bawah, dan menghapus riwayat port fisik karena
// seseorang salah ketik angka kapasitas.
//
// Nomor global juga dijaga di sini: menambah kapasitas TIDAK BOLEH menomori
// ulang port lama. Setiap label yang sudah tertempel di lapangan bergantung
// pada itu.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/server/rbac", () => ({
  withRole:
    (_roles: string[], handler: (r: Request, u: unknown, c: unknown) => Promise<Response>) =>
    (request: Request, context: unknown) =>
      handler(request, { id: "u1", name: "Penguji", email: "uji@contoh.id", role: "admin" }, context),
}));

import * as schema from "@/db/schema";
import * as authSchema from "@/db/auth-schema";
import { POST as BUAT } from "@/app/api/v1/ftth/otb/route";
import { PATCH as UBAH_KAPASITAS } from "@/app/api/v1/ftth/otb/[otbId]/trays/[trayNumber]/route";
import { PATCH as UBAH_PORT } from "@/app/api/v1/ftth/otb/[otbId]/trays/[trayNumber]/ports/route";

const MIGRATION_DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const migrationSql = readdirSync(MIGRATION_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATION_DIR, f), "utf8"))
  .join("\n");

let client: PGlite;
let otbId: string;

function ctx(trayNumber: number) {
  return { params: Promise.resolve({ otbId, trayNumber: String(trayNumber) }) };
}

function kapasitas(trayNumber: number, portCount: number) {
  return UBAH_KAPASITAS(
    new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ portCount }) }),
    ctx(trayNumber),
  );
}

function ubahPort(trayNumber: number, portNumberInTray: number, patch: Record<string, unknown>) {
  return UBAH_PORT(
    new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ portNumberInTray, ...patch }) }),
    ctx(trayNumber),
  );
}

async function semuaPort() {
  const db = mocks.db as ReturnType<typeof drizzle>;
  return db.select().from(schema.otbPorts).orderBy(asc(schema.otbPorts.globalPortNumber));
}

beforeEach(async () => {
  client = new PGlite();
  await client.exec(migrationSql);
  mocks.db = drizzle(client, { schema: { ...schema, ...authSchema } });
  const db = mocks.db as ReturnType<typeof drizzle>;
  await db.insert(schema.networkSites).values({ id: "s1", code: "KCC", name: "Kecicang" });
  await db.insert(authSchema.user).values({
    id: "u1", name: "Penguji", email: "uji@contoh.id",
    emailVerified: true, createdAt: new Date(), updatedAt: new Date(),
  });
  // 3 tray × 12 port = 36 port, nomor global 1..36.
  const res = await BUAT(
    new Request("http://localhost/api/v1/ftth/otb", {
      method: "POST",
      body: JSON.stringify({ code: "K", name: "Kapasitas", siteId: "s1", connectorType: "SC", trayCount: 3 }),
    }),
    undefined,
  );
  otbId = (await res.json()).id;
});

afterEach(async () => {
  await client.close();
});

describe("menambah kapasitas", () => {
  it("port baru menyambung dari nomor global TERBESAR, port lama tidak bergerak", async () => {
    const sebelum = await semuaPort();
    expect(sebelum.map((p) => p.globalPortNumber)).toEqual(Array.from({ length: 36 }, (_, i) => i + 1));

    const res = await kapasitas(1, 16);
    expect(res.status).toBe(200);
    expect((await res.json()).portCount).toBe(16);

    const sesudah = await semuaPort();
    expect(sesudah).toHaveLength(40);

    // Nomor global port lama identik — ini yang dijaga. Implementasi yang
    // menomori ulang seluruh OTB akan menggeser tray 2 dan 3.
    for (const lama of sebelum) {
      const kini = sesudah.find((p) => p.id === lama.id)!;
      expect(kini.globalPortNumber).toBe(lama.globalPortNumber);
    }
    // Empat port baru menempati 37..40, bukan menyisip di 13..16.
    const baru = sesudah.filter((p) => !sebelum.some((l) => l.id === p.id));
    expect(baru.map((p) => p.globalPortNumber).sort((a, b) => a - b)).toEqual([37, 38, 39, 40]);
    expect(baru.map((p) => p.portNumberInTray).sort((a, b) => a - b)).toEqual([13, 14, 15, 16]);
  });
});

describe("menurunkan kapasitas", () => {
  it("tray yang belum pernah disentuh boleh dikecilkan", async () => {
    const res = await kapasitas(3, 8);
    expect(res.status).toBe(200);
    expect(await semuaPort()).toHaveLength(32);
  });

  it("port yang sedang terpakai menahan penurunan", async () => {
    await ubahPort(3, 10, { status: "terpakai" });
    const res = await kapasitas(3, 8);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("10");
    expect(await semuaPort()).toHaveLength(36);
  });

  it("port yang PERNAH terpakai lalu dibebaskan tetap menahan penurunan", async () => {
    // Inti FR-OTB-003. Setelah dibebaskan, statusnya `kosong` — persis sama
    // dengan port yang belum pernah dipakai. Implementasi yang hanya melihat
    // `status` akan menghapusnya beserta riwayatnya.
    await ubahPort(3, 10, { status: "terpakai" });
    await ubahPort(3, 10, { status: "kosong", externalServiceId: null });

    const db = mocks.db as ReturnType<typeof drizzle>;
    const port = (await semuaPort()).find((p) => p.globalPortNumber === 34)!;
    expect(port.status).toBe("kosong");

    const res = await kapasitas(3, 8);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/riwayat/);
    expect(await db.select().from(schema.otbPorts)).toHaveLength(36);
  });

  it("port kosong yang masih memegang externalServiceId menahan penurunan", async () => {
    const db = mocks.db as ReturnType<typeof drizzle>;
    // Ditulis langsung ke database supaya TIDAK ada baris audit — kalau
    // lewat PATCH, yang menahan bisa jadi jejaknya, bukan kolomnya.
    const port = (await semuaPort()).find((p) => p.globalPortNumber === 36)!;
    await db.update(schema.otbPorts).set({ externalServiceId: "SRV-9" }).where(eq(schema.otbPorts.id, port.id));

    const res = await kapasitas(3, 8);
    expect(res.status).toBe(409);
    expect(await semuaPort()).toHaveLength(36);
  });

  it("penolakan tidak mengubah apa pun", async () => {
    await ubahPort(3, 12, { status: "rusak" });
    const sebelum = await semuaPort();
    const res = await kapasitas(3, 1);
    expect(res.status).toBe(409);
    const sesudah = await semuaPort();
    expect(sesudah.map((p) => p.id)).toEqual(sebelum.map((p) => p.id));
  });

  it("riwayat di tray LAIN tidak ikut menahan — aturannya hanya soal port yang akan hilang", async () => {
    // Negatif-dari-negatif: membuktikan cakupan aturan tidak kelewat luas.
    // Implementasi yang menyapu seluruh OTB akan menolak ini.
    await ubahPort(1, 5, { status: "terpakai" });
    const res = await kapasitas(3, 8);
    expect(res.status).toBe(200);
    expect(await semuaPort()).toHaveLength(32);
  });

  it("port yang bertahan tidak dinomori ulang setelah penurunan", async () => {
    await kapasitas(1, 6);
    const tersisa = await semuaPort();
    const trayId = tersisa.find((p) => p.globalPortNumber === 1)!.trayId;
    const tray1 = tersisa.filter((p) => p.trayId === trayId);
    expect(tray1.map((p) => p.globalPortNumber).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    // Tray 2 tetap mulai dari 13 — lubang 7..12 memang dibiarkan.
    expect(tersisa.map((p) => p.globalPortNumber)).toContain(13);
    expect(tersisa.map((p) => p.globalPortNumber)).not.toContain(7);
  });

  it("menambah setelah menurunkan menyambung dari max, tidak mengisi lubang", async () => {
    await kapasitas(1, 6);
    const res = await kapasitas(1, 8);
    expect(res.status).toBe(200);
    const port = await semuaPort();
    const trayId = port.find((p) => p.globalPortNumber === 1)!.trayId;
    const tray1 = port.filter((p) => p.trayId === trayId).map((p) => p.globalPortNumber).sort((a, b) => a - b);
    // 37 dan 38, bukan 7 dan 8 — mengisi lubang berarti memakai ulang nomor
    // yang pernah terbit, dan itu membatalkan janji identitas permanen.
    expect(tray1).toEqual([1, 2, 3, 4, 5, 6, 37, 38]);
  });

  it("portCount di luar 1–256 ditolak", async () => {
    for (const portCount of [0, 257, 2.5]) {
      expect((await kapasitas(1, portCount)).status).toBe(400);
    }
  });

  it("tray yang tidak ada → 404", async () => {
    expect((await kapasitas(99, 4)).status).toBe(404);
  });
});
