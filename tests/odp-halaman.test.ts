// Pencarian, penyaringan, dan halaman ODP — dikerjakan database, bukan browser.
//
// Yang dijaga:
//   1. `total` menghitung ODP, BUKAN port. Join ke `odp_ports` menggandakan
//      baris; `count(*)` di atasnya akan menjawab 8.656 alih-alih 580.
//   2. Tanpa parameter halaman, jawabannya tetap seperti dulu — layar lama
//      tidak boleh diam-diam kehilangan 560 dari 580 barisnya.
//   3. Pencarian di server mencakup SELURUH tabel, bukan hanya halaman ini.
//   4. `usedPorts` diturunkan dari tabel port, dan tidak digandakan join.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));

import * as schema from "@/db/schema";
import { KOLOM_URUT, cariOdp, kunciUrut } from "@/server/odp-read";

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
    { id: "situs-a", code: "KCG", name: "Kecicang" },
    { id: "situs-b", code: "ABG", name: "Abang" },
  ]);
  await d().insert(schema.oltDevices).values([
    { id: "olt-1", name: "OLT Satu", managementIp: "192.168.100.60" },
    { id: "olt-2", name: "OLT Dua", managementIp: "192.168.100.61" },
  ]);

  // 25 ODP: cukup untuk melewati halaman 20 tanpa memperlambat tes.
  const baris = Array.from({ length: 25 }, (_, i) => ({
    id: `odp-${i + 1}`,
    code: `ODP-${String(i + 1).padStart(3, "0")}`,
    name: i === 0 ? "ODP Melati Satu" : `ODP Nomor ${i + 1}`,
    siteId: i < 10 ? "situs-a" : "situs-b",
    oltId: i < 5 ? "olt-1" : "olt-2",
    capacity: 8,
  }));
  await d().insert(schema.odps).values(baris);

  // ODP pertama: 8 port, 3 terpakai, 1 rusak.
  await d().insert(schema.odpPorts).values(
    Array.from({ length: 8 }, (_, i) => ({
      id: `p-${i + 1}`,
      odpId: "odp-1",
      portNumber: i + 1,
      status: (i < 3 ? "terpakai" : i === 3 ? "rusak" : "kosong") as "terpakai" | "rusak" | "kosong",
    })),
  );
});

afterEach(async () => { await client.close(); });

describe("cariOdp", () => {
  it("total menghitung ODP, BUKAN port", async () => {
    // Join ke `odp_ports` menggandakan baris. `count(*)` di atas join itu
    // menjawab jumlah port — di produksi 8.656 alih-alih 580, dan paginasinya
    // ikut salah tanpa ada yang tahu.
    const h = await cariOdp({});
    expect(h.total).toBe(25);
  });

  it("usedPorts dan brokenPorts diturunkan, tidak digandakan join", async () => {
    const h = await cariOdp({ q: "ODP-001" });
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0].usedPorts).toBe(3);
    expect(h.rows[0].brokenPorts).toBe(1);
    expect(h.rows[0].capacity).toBe(8);
  });

  it("tanpa parameter halaman, SELURUH baris tetap dikirim", async () => {
    // Layar `/ftth` hari ini memanggil tanpa satu pun parameter. Memaksakan
    // paginasi sebagai bawaan membuatnya diam-diam memperlihatkan 20 dari 25.
    const h = await cariOdp({});
    expect(h.berhalaman).toBe(false);
    expect(h.rows).toHaveLength(25);
    expect(h.terpotong).toBe(false);
  });

  it("halaman dipakai begitu page atau pageSize disebut", async () => {
    const h = await cariOdp({ page: 2, pageSize: 20 });
    expect(h.berhalaman).toBe(true);
    expect(h.rows).toHaveLength(5);
    expect(h.total).toBe(25);
    expect(h.halamanTerakhir).toBe(2);
  });

  it("pencarian mencakup seluruh tabel, bukan hanya halaman ini", async () => {
    // ODP-025 ada di halaman kedua. Penyaringan di browser tidak akan pernah
    // menemukannya kalau halaman pertama yang terkirim.
    const h = await cariOdp({ q: "ODP-025", page: 1, pageSize: 20 });
    expect(h.total).toBe(1);
    expect(h.rows[0].code).toBe("ODP-025");
  });

  it("cari mencakup kode DAN nama", async () => {
    const kode = await cariOdp({ q: "odp-001" });
    expect(kode.rows.map((r) => r.id)).toEqual(["odp-1"]);
    const nama = await cariOdp({ q: "melati" });
    expect(nama.rows.map((r) => r.id)).toEqual(["odp-1"]);
  });

  it("menyaring per situs dan per OLT", async () => {
    expect((await cariOdp({ siteId: "situs-a" })).total).toBe(10);
    expect((await cariOdp({ oltId: "olt-1" })).total).toBe(5);
    expect((await cariOdp({ siteId: "situs-a", oltId: "olt-2" })).total).toBe(5);
  });

  it("halaman di luar jangkauan dijepit, bukan mengembalikan kosong", async () => {
    const h = await cariOdp({ page: 99, pageSize: 20 });
    expect(h.page).toBe(2);
    expect(h.rows).toHaveLength(5);
  });

  it("kunci urut SELALU ditutup `code` sebagai pemecah seri", () => {
    // Diuji strukturnya, bukan hasilnya: tanpa pemecah seri, `ORDER BY
    // capacity` di atas 580 ODP berkapasitas sama tidak menentukan urutan
    // apa pun, dan PostgreSQL bebas mengembalikannya berbeda antar-permintaan.
    // Tes yang menjalankan kueri asli bisa lolos seratus kali lalu gagal di
    // produksi — uji mutasi 22 Agustus 2026 membuktikan itu: membuang
    // pemecah serinya tidak menggagalkan satu tes pun.
    for (const sort of KOLOM_URUT) {
      for (const dir of ["asc", "desc"] as const) {
        const kunci = kunciUrut(sort, dir);
        expect(kunci, `${sort}/${dir}`).toHaveLength(2);
        // Kunci terakhir harus `code` menaik, apa pun kolom utamanya.
        expect(kunci[1], `${sort}/${dir}`).toEqual(asc(schema.odps.code));
      }
    }
  });

  it("mengurut per kolom, dan tidak pernah melewatkan baris antar-halaman", async () => {
    // Tanpa pemecah seri yang pasti, dua halaman berturut-turut bisa memuat
    // baris yang sama dan melewatkan yang lain — kapasitas semua ODP di sini
    // sama, jadi pengurutan `capacity` saja tidak menentukan urutan.
    const h1 = await cariOdp({ sort: "capacity", page: 1, pageSize: 20 });
    const h2 = await cariOdp({ sort: "capacity", page: 2, pageSize: 20 });
    const semua = [...h1.rows, ...h2.rows].map((r) => r.id);
    expect(new Set(semua).size).toBe(25);
  });

  it("urutan menurun benar-benar membalik", async () => {
    const naik = await cariOdp({ sort: "code", dir: "asc", page: 1, pageSize: 20 });
    const turun = await cariOdp({ sort: "code", dir: "desc", page: 1, pageSize: 20 });
    expect(naik.rows[0].code).toBe("ODP-001");
    expect(turun.rows[0].code).toBe("ODP-025");
  });

  it("sort dan pageSize yang tidak dikenal jatuh ke bawaan, bukan melempar", async () => {
    const h = await cariOdp({ sort: "entah" as never, pageSize: 9999, page: 1 });
    expect(h.pageSize).toBe(20);
    expect(h.rows[0].code).toBe("ODP-001");
  });
});
