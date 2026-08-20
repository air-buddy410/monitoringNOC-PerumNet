// Token layar TV.
//
// Pemilik memilih token di URL setelah risikonya disampaikan. Yang diuji di
// sini adalah semua kebocoran yang BISA ditutup tanpa mengubah pilihan itu —
// dan yang paling penting: token polos tidak boleh pernah tersimpan, dan
// pencabutan harus berlaku SEKETIKA, bukan menunggu cookie kedaluwarsa.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));

import * as schema from "@/db/schema";
import {
  bacaNilaiCookie,
  buatNilaiCookie,
  buatToken,
  cabutToken,
  catatPemakaian,
  daftarToken,
  tokenMasihBerlaku,
  verifikasiToken,
} from "@/server/tv-token";

const MIGRATION_DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const migrationSql = readdirSync(MIGRATION_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATION_DIR, f), "utf8"))
  .join("\n");

let client: PGlite;
let db: ReturnType<typeof drizzle>;
const T0 = new Date("2026-08-20T10:00:00.000Z");

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = "rahasia-uji-yang-cukup-panjang-sekali";
});

beforeEach(async () => {
  client = new PGlite();
  await client.exec(migrationSql);
  db = drizzle(client, { schema });
  mocks.db = db;
});

afterEach(async () => {
  await client.close();
});

describe("penyimpanan token", () => {
  it("token polos TIDAK PERNAH tersimpan di kolom mana pun", async () => {
    const t = await buatToken({ name: "TV Ruang NOC", createdBy: null, now: T0 });
    const [row] = await db.select().from(schema.tvTokens);
    const seluruhBaris = JSON.stringify(row);
    expect(seluruhBaris).not.toContain(t.token);
    // prefix 8 karakter memang disimpan supaya token bisa dikenali —
    // itu disengaja, dan bukan tokennya.
    expect(row.tokenPrefix).toBe(t.token.slice(0, 8));
    expect(row.tokenHash).not.toBe(t.token);
  });

  it("dua token berbeda tidak pernah bertabrakan", async () => {
    const a = await buatToken({ name: "A", createdBy: null, now: T0 });
    const b = await buatToken({ name: "B", createdBy: null, now: T0 });
    expect(a.token).not.toBe(b.token);
  });

  it("kedaluwarsa dijepit ke batas atas", async () => {
    const t = await buatToken({
      name: "abadi?", createdBy: null, expiresInDays: 99_999, now: T0,
    });
    const hari = (t.expiresAt.getTime() - T0.getTime()) / 86_400_000;
    expect(hari).toBe(365);
  });

  it("daftar untuk layar admin tidak pernah memuat hash maupun token", async () => {
    const t = await buatToken({ name: "TV", createdBy: null, now: T0 });
    const daftar = JSON.stringify(await daftarToken());
    expect(daftar).not.toContain(t.token);
    expect(daftar).not.toContain("tokenHash");
  });
});

describe("verifikasi", () => {
  it("token benar diterima", async () => {
    const t = await buatToken({ name: "TV", createdBy: null, now: T0 });
    const h = await verifikasiToken(t.token, T0);
    expect(h.ok).toBe(true);
  });

  it("token asing ditolak", async () => {
    await buatToken({ name: "TV", createdBy: null, now: T0 });
    expect(await verifikasiToken("bukan-token", T0)).toEqual({
      ok: false, sebab: "TIDAK_DIKENAL",
    });
  });

  it("token yang dicabut ditolak", async () => {
    const t = await buatToken({ name: "TV", createdBy: null, now: T0 });
    await cabutToken(t.id, null, T0);
    expect((await verifikasiToken(t.token, T0)).ok).toBe(false);
  });

  it("token kedaluwarsa ditolak", async () => {
    const t = await buatToken({ name: "TV", createdBy: null, expiresInDays: 1, now: T0 });
    const nanti = new Date(T0.getTime() + 2 * 86_400_000);
    const h = await verifikasiToken(t.token, nanti);
    expect(h).toEqual({ ok: false, sebab: "KEDALUWARSA" });
  });
});

describe("cookie", () => {
  it("cookie TIDAK memuat tokennya, hanya rujukan bertanda tangan", async () => {
    const t = await buatToken({ name: "TV", createdBy: null, now: T0 });
    const c = buatNilaiCookie(t.id, Math.floor(T0.getTime() / 1000) + 3600);
    expect(c).not.toContain(t.token);
    expect(bacaNilaiCookie(c, T0)).toBe(t.id);
  });

  it("tanda tangan yang diubah satu karakter ditolak", () => {
    const exp = Math.floor(T0.getTime() / 1000) + 3600;
    const c = buatNilaiCookie("id-1", exp);
    const rusak = c.slice(0, -1) + (c.endsWith("a") ? "b" : "a");
    expect(bacaNilaiCookie(rusak, T0)).toBeNull();
  });

  it("id yang ditukar tanpa menandatangani ulang ditolak", () => {
    const exp = Math.floor(T0.getTime() / 1000) + 3600;
    const c = buatNilaiCookie("id-1", exp);
    const tanda = c.split(".")[2];
    expect(bacaNilaiCookie(`id-2.${exp}.${tanda}`, T0)).toBeNull();
  });

  it("cookie kedaluwarsa ditolak", () => {
    const exp = Math.floor(T0.getTime() / 1000) - 10;
    expect(bacaNilaiCookie(buatNilaiCookie("id-1", exp), T0)).toBeNull();
  });

  it("bentuk cacat ditolak tanpa melempar", () => {
    for (const buruk of ["", "a", "a.b", "a.b.c.d", undefined, null]) {
      expect(bacaNilaiCookie(buruk as string, T0)).toBeNull();
    }
  });
});

describe("pencabutan berlaku SEKETIKA", () => {
  it("cookie yang masih hidup berhenti bekerja begitu token dicabut", async () => {
    // Ini inti rancangannya: cookie sengaja stateless, tapi tiap permintaan
    // tetap memeriksa barisnya. Kalau tidak, mencabut token berarti menunggu
    // 12 jam sampai layarnya mati.
    const t = await buatToken({ name: "TV", createdBy: null, now: T0 });
    expect(await tokenMasihBerlaku(t.id, T0)).toBe(true);
    await cabutToken(t.id, null, T0);
    expect(await tokenMasihBerlaku(t.id, T0)).toBe(false);
  });

  it("token yang lewat masa berlakunya berhenti tanpa perlu dicabut", async () => {
    const t = await buatToken({ name: "TV", createdBy: null, expiresInDays: 1, now: T0 });
    const nanti = new Date(T0.getTime() + 2 * 86_400_000);
    expect(await tokenMasihBerlaku(t.id, nanti)).toBe(false);
  });
});

describe("catatan pemakaian", () => {
  it("tidak menulis lebih dari sekali per 5 menit", async () => {
    // Wallboard memanggil tiap 5 detik; tanpa peredam ini satu layar
    // menghasilkan 17.000 UPDATE per hari.
    const t = await buatToken({ name: "TV", createdBy: null, now: T0 });
    await catatPemakaian(t.id, T0);
    await catatPemakaian(t.id, new Date(T0.getTime() + 30_000));
    const [row] = await db.select().from(schema.tvTokens);
    expect(row.useCount).toBe(1);

    await catatPemakaian(t.id, new Date(T0.getTime() + 6 * 60_000));
    const [row2] = await db.select().from(schema.tvTokens);
    expect(row2.useCount).toBe(2);
  });
});
