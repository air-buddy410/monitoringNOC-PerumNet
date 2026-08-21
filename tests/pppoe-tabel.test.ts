// Sesi PPPoE: penyaringan, pengurutan, dan halaman dikerjakan DATABASE.
//
// Sebelum ini endpoint mengirim seluruh sesi (batas 2.000) dan layar
// menyaring sendiri. Dua hal yang salah dengan itu, dan tes di bawah menjaga
// keduanya tetap tertutup:
//
//   1. BEBAN. ~1.600 baris JSON tiap kali halaman dibuka, untuk menampilkan
//      dua puluh.
//   2. KEBOHONGAN HALUS. Penyaringan di browser hanya menyaring yang
//      TERKIRIM. Begitu jumlah sesi melewati batas, pencarian jadi tidak
//      lengkap tanpa ada yang tahu — dan "pelanggan itu tidak ada di daftar"
//      terlihat persis sama dengan "pelanggan itu offline".

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
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
import { GET } from "@/app/api/v1/pppoe/sessions/route";

const MIGRATION_DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const migrationSql = readdirSync(MIGRATION_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATION_DIR, f), "utf8"))
  .join("\n");

let client: PGlite;

async function panggil(qs: string) {
  const res = await GET(new Request(`http://localhost/api/v1/pppoe/sessions${qs}`), undefined);
  return { status: res.status, body: await res.json() };
}

beforeEach(async () => {
  client = new PGlite();
  await client.exec(migrationSql);
  mocks.db = drizzle(client, { schema });

  const now = Date.now();
  await (mocks.db as ReturnType<typeof drizzle>).insert(schema.pppoeSessions).values(
    Array.from({ length: 137 }, (_, i) => ({
      id: `s${i}`,
      username: `pel${String(i).padStart(3, "0")}@perumnet`,
      address: `10.20.${Math.floor(i / 250)}.${i % 250}`,
      callerId: `AA:BB:${String(i).padStart(2, "0")}`,
      uptimeSec: i * 60,
      routerName: i % 3 === 0 ? "RB-Kecicang" : "RB-Seraya",
      seenAt: new Date(now - i * 1000),
    })),
  );
});

afterEach(async () => {
  await client.close();
});

describe("halaman", () => {
  it("tanpa parameter, jawabannya tetap seperti dulu — seluruh sesi", async () => {
    // Kompatibilitas disengaja: tanpa ini, layar lama diam-diam kehilangan
    // 117 barisnya di antara deploy backend dan pembaruan frontend.
    const { body } = await panggil("");
    expect(body.sessions).toHaveLength(137);
    expect(body.total).toBe(137);
  });

  it("pageSize membatasi baris yang dikirim, total tetap jumlah sebenarnya", async () => {
    const { body } = await panggil("?page=1&pageSize=20");
    expect(body.sessions).toHaveLength(20);
    expect(body.total).toBe(137);
    expect(body.halamanTerakhir).toBe(7);
  });

  it("ketiga ukuran diterima, selain itu ditolak", async () => {
    for (const n of [20, 50, 100]) {
      const { body } = await panggil(`?page=1&pageSize=${n}`);
      expect(body.sessions).toHaveLength(n);
    }
    for (const n of [0, 19, 500, 5000]) {
      expect((await panggil(`?page=1&pageSize=${n}`)).status).toBe(400);
    }
  });

  it("halaman terakhir berisi sisanya, bukan kosong", async () => {
    const { body } = await panggil("?page=7&pageSize=20");
    expect(body.sessions).toHaveLength(137 - 6 * 20);
  });

  it("halaman di luar jangkauan dijepit, bukan mengembalikan kosong", async () => {
    // Jumlah sesi berubah tiap dua menit; halaman 9 yang sah saat diklik bisa
    // sudah tidak ada saat permintaannya tiba. Layar kosong tanpa penjelasan
    // terbaca sebagai "semua pelanggan hilang".
    const { body } = await panggil("?page=99&pageSize=20");
    expect(body.page).toBe(7);
    expect(body.sessions.length).toBeGreaterThan(0);
  });

  it("halaman tidak tumpang tindih dan menutupi semuanya", async () => {
    const terkumpul: string[] = [];
    for (let h = 1; h <= 7; h += 1) {
      const { body } = await panggil(`?page=${h}&pageSize=20`);
      terkumpul.push(...body.sessions.map((s: { username: string }) => s.username));
    }
    expect(terkumpul).toHaveLength(137);
    expect(new Set(terkumpul).size).toBe(137);
  });
});

describe("penyaringan", () => {
  it("mencari di username, address, dan callerId sekaligus", async () => {
    expect((await panggil("?q=pel005")).body.total).toBe(1);
    expect((await panggil("?q=10.20.0.7&page=1&pageSize=20")).body.total).toBeGreaterThan(0);
    // AA:BB:99 tidak punya lanjutan (data berhenti di 136), jadi tepat satu.
    expect((await panggil("?q=AA:BB:99")).body.total).toBe(1);
  });

  it("pencarian memang substring — AA:BB:12 juga cocok dengan AA:BB:120..129", async () => {
    // Bukan bug, dan bukan kebetulan: operator mengetik potongan yang dia
    // ingat, bukan nilai persis. Yang penting jumlahnya dihitung database,
    // jadi hasilnya tidak berubah saat datanya membesar.
    const { body } = await panggil("?q=AA:BB:12&page=1&pageSize=20");
    expect(body.total).toBe(11);
  });

  it("pencarian tidak peduli huruf besar-kecil", async () => {
    expect((await panggil("?q=PEL005")).body.total).toBe(1);
  });

  it("penyaringan dihitung DATABASE — total ikut menyusut, bukan cuma barisnya", async () => {
    // Inilah bedanya dengan menyaring di browser. Kalau `total` tetap 137
    // sementara barisnya tersaring, berarti penyaringannya terjadi setelah
    // pengambilan — dan pencarian akan tidak lengkap begitu datanya membesar.
    const { body } = await panggil("?q=pel00&page=1&pageSize=20");
    expect(body.total).toBe(10);
    expect(body.sessions).toHaveLength(10);
  });

  it("menyaring per router, dan daftar routernya ikut dikirim", async () => {
    const { body } = await panggil("?router=RB-Kecicang&page=1&pageSize=100");
    expect(body.total).toBe(46);
    expect(body.sessions.every((s: { routerName: string }) => s.routerName === "RB-Kecicang")).toBe(true);
    expect(body.routers.sort()).toEqual(["RB-Kecicang", "RB-Seraya"]);
  });

  it("saringan digabung: q DAN router", async () => {
    const { body } = await panggil("?q=pel00&router=RB-Kecicang&page=1&pageSize=20");
    expect(body.total).toBeLessThan(10);
    expect(body.sessions.every((s: { routerName: string }) => s.routerName === "RB-Kecicang")).toBe(true);
  });

  it("saringan yang tidak cocok apa pun mengembalikan kosong dengan total 0", async () => {
    const { body } = await panggil("?q=tidak-ada-sama-sekali");
    expect(body.total).toBe(0);
    expect(body.sessions).toHaveLength(0);
  });
});

describe("pengurutan", () => {
  it("mengurut naik dan turun pada kolom yang diminta", async () => {
    const naik = await panggil("?sort=uptime&dir=asc&page=1&pageSize=20");
    const turun = await panggil("?sort=uptime&dir=desc&page=1&pageSize=20");
    expect(naik.body.sessions[0].uptimeSec).toBe(0);
    expect(turun.body.sessions[0].uptimeSec).toBe(136 * 60);
  });

  it("pengurutan berlaku pada SELURUH data, bukan hanya halaman yang tampil", async () => {
    // Kalau diurut setelah pemenggalan, halaman 1 "uptime terbesar" akan
    // berisi 20 pertama menurut username yang kebetulan diurut ulang.
    const { body } = await panggil("?sort=uptime&dir=desc&page=1&pageSize=20");
    expect(body.sessions[0].uptimeSec).toBe(136 * 60);
    expect(body.sessions[19].uptimeSec).toBe(117 * 60);
  });

  it("kolom urut yang tidak dikenal ditolak, bukan diabaikan diam-diam", async () => {
    const { status, body } = await panggil("?sort=ngawur");
    expect(status).toBe(400);
    expect(body.error).toMatch(/username/);
  });

  it("arah urut yang tidak dikenal ditolak", async () => {
    expect((await panggil("?dir=samping")).status).toBe(400);
  });

  it("urutannya pasti — dua sesi dengan nilai sama tidak berpindah antar-muat", async () => {
    // Tanpa kunci kedua, PostgreSQL boleh mengembalikan urutan berbeda tiap
    // kali, dan baris bisa muncul di dua halaman sekaligus.
    const a = await panggil("?sort=router&dir=asc&page=1&pageSize=20");
    const b = await panggil("?sort=router&dir=asc&page=1&pageSize=20");
    expect(a.body.sessions.map((s: { username: string }) => s.username)).toEqual(
      b.body.sessions.map((s: { username: string }) => s.username),
    );
  });
});
