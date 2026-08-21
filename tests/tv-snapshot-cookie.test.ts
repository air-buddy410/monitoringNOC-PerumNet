// Umur layar TV, dan cara mematikannya.
//
// Dua sifat yang saling menarik ke arah berlawanan, dan keduanya harus benar:
//
//   1. **Layar tidak boleh mati sendiri.** Cookienya berumur 12 jam, dan
//      tokennya sudah dihapus dari address bar demi keamanan. Tanpa pembaruan
//      tiap permintaan, wallboard padam diam-diam pada jam ke-12 dan tidak ada
//      keyboard di sana untuk menghidupkannya lagi.
//   2. **Pencabutan tetap harus SEKETIKA.** Pembaruan cookie tidak boleh
//      berubah jadi cara token yang sudah dicabut hidup lebih lama.
//
// Sifat 1 tanpa sifat 2 adalah pintu belakang. Karena itu keduanya diuji di
// berkas yang sama — supaya yang melonggarkan satu sisi melihat sisi lainnya.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  cookieValue: undefined as string | undefined,
}));

vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nama: string) =>
      nama === "noc_tv" && mocks.cookieValue !== undefined
        ? { name: nama, value: mocks.cookieValue }
        : undefined,
  }),
}));
// Isi muatannya tidak diuji di sini — tests/tv-snapshot-sanitize.test.ts yang
// menjaga bentuknya. Di-mock supaya tes ini tidak menyeret seluruh skema.
vi.mock("@/server/tv-snapshot", () => ({
  bacaTvSnapshot: async () => ({ generatedAt: "2026-08-21T00:00:00.000Z" }),
}));

import * as schema from "@/db/schema";
import { GET } from "@/app/api/v1/tv/snapshot/route";
import { buatNilaiCookie, buatToken, cabutToken } from "@/server/tv-token";

const MIGRATION_DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const migrationSql = readdirSync(MIGRATION_DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(path.join(MIGRATION_DIR, file), "utf8"))
  .join("\n");

let client: PGlite;

/** Max-Age dari header Set-Cookie, atau null bila tidak ada cookie dipasang. */
function maxAge(res: Response): number | null {
  const raw = res.headers.get("set-cookie");
  if (!raw) return null;
  const m = /Max-Age=(\d+)/i.exec(raw);
  return m ? Number(m[1]) : null;
}

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET ??= "rahasia-untuk-pengujian";
});

beforeEach(async () => {
  client = new PGlite();
  await client.exec(migrationSql);
  mocks.db = drizzle(client, { schema });
  mocks.cookieValue = undefined;
});

afterEach(async () => {
  await client.close();
});

/** Cookie sah untuk token itu, seperti yang dibuat POST /api/v1/tv/session. */
function cookieUntuk(tokenId: string, umurDetik = 12 * 3600): string {
  return buatNilaiCookie(tokenId, Math.floor(Date.now() / 1000) + umurDetik);
}

describe("GET /api/v1/tv/snapshot", () => {
  it("memperbarui cookie tiap permintaan supaya layar tidak mati pada jam ke-12", async () => {
    const t = await buatToken({ name: "Wallboard NOC", createdBy: null });
    // Cookie yang tinggal 3 menit lagi — persis keadaan menjelang layar padam.
    mocks.cookieValue = cookieUntuk(t.id, 180);

    const res = await GET();
    expect(res.status).toBe(200);
    // Diperpanjang penuh kembali, bukan dibiarkan menuju nol.
    expect(maxAge(res)).toBeGreaterThan(11 * 3600);
  });

  it("perpanjangan TIDAK PERNAH melampaui masa berlaku token", async () => {
    // Token tinggal 30 menit. Cookie 12 jam akan membuat layar hidup 11,5 jam
    // lebih lama dari izin yang diberikan kepadanya.
    const t = await buatToken({ name: "Hampir habis", createdBy: null, expiresInDays: 1 });
    await mocks.db /* majukan kedaluwarsa token ke 30 menit dari sekarang */;
    await client.exec(
      `UPDATE tv_tokens SET expires_at = NOW() + INTERVAL '30 minutes' WHERE id = '${t.id}'`,
    );
    mocks.cookieValue = cookieUntuk(t.id);

    const res = await GET();
    expect(res.status).toBe(200);
    const umur = maxAge(res);
    expect(umur).not.toBeNull();
    expect(umur!).toBeLessThanOrEqual(30 * 60);
    expect(umur!).toBeGreaterThan(25 * 60);
  });

  it("token yang dicabut mati pada polling BERIKUTNYA, bukan saat cookie habis", async () => {
    const t = await buatToken({ name: "Akan dicabut", createdBy: null });
    mocks.cookieValue = cookieUntuk(t.id);

    expect((await GET()).status).toBe(200);

    await cabutToken(t.id, null);

    // Cookienya masih sah dan belum kedaluwarsa — yang berubah hanya barisnya.
    const res = await GET();
    expect(res.status).toBe(401);
    expect(maxAge(res)).toBeNull();
  });

  it("cookie yang tandanya dipalsukan ditolak", async () => {
    const t = await buatToken({ name: "Palsu", createdBy: null });
    const sah = cookieUntuk(t.id);
    // Ubah satu karakter tanda tangannya.
    const rusak = sah.slice(0, -1) + (sah.endsWith("a") ? "b" : "a");
    mocks.cookieValue = rusak;

    expect((await GET()).status).toBe(401);
  });

  it("tanpa cookie sama sekali: 401, bukan muatan", async () => {
    mocks.cookieValue = undefined;
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toHaveProperty("error");
  });
});
