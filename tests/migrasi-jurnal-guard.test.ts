// Berkas migrasi dan jurnalnya harus cocok, satu lawan satu.
//
// Kenapa ini perlu dijaga: `drizzle-kit` memilih migrasi mana yang perlu
// dijalankan dari `meta/_journal.json`, BUKAN dari daftar berkas. Sebuah
// berkas .sql tanpa entri jurnal tidak akan pernah dijalankan — tidak ada
// galat, tidak ada peringatan, hanya tabel yang tidak pernah muncul. Entri
// jurnal tanpa berkasnya membuat migrator gagal di tengah.
//
// Bukan kekhawatiran teoretis: 21 Agustus 2026 entri 0008 sempat hilang dari
// jurnal sementara berkasnya tetap ada, karena satu perintah git yang
// menimpa berkas terlacak. Ketidakcocokannya tidak menimbulkan gejala apa pun
// sampai migrasi dijalankan.
//
// Sepupunya di sisi database — tabel `drizzle.__drizzle_migrations` yang
// melenceng dari kenyataan — TIDAK bisa dijaga dari sini; ia hidup di
// produksi. Prosedur memeriksanya ada di docs/OPERATIONS.md §13.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.resolve(__dirname, "..", "drizzle", "pg");

const berkas = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const jurnal = JSON.parse(
  readFileSync(path.join(DIR, "meta", "_journal.json"), "utf8"),
) as { entries: Array<{ idx: number; tag: string; when: number }> };

describe("migrasi dan jurnalnya", () => {
  it("setiap berkas .sql punya entri jurnal, dan sebaliknya", () => {
    const dariBerkas = berkas.map((f) => f.replace(/\.sql$/, ""));
    const dariJurnal = [...jurnal.entries]
      .sort((a, b) => a.idx - b.idx)
      .map((e) => e.tag);
    expect(dariJurnal).toEqual(dariBerkas);
  });

  it("setiap entri jurnal punya berkas snapshot-nya", () => {
    const snapshot = new Set(
      readdirSync(path.join(DIR, "meta")).filter((f) => f.endsWith("_snapshot.json")),
    );
    for (const e of jurnal.entries) {
      const nomor = String(e.idx).padStart(4, "0");
      expect(snapshot, `snapshot ${nomor} hilang`).toContain(`${nomor}_snapshot.json`);
    }
  });

  it("idx berurut dari 0 tanpa lubang", () => {
    const idx = jurnal.entries.map((e) => e.idx).sort((a, b) => a - b);
    expect(idx).toEqual(idx.map((_, i) => i));
  });

  it("`when` menaik mengikuti idx", () => {
    // Drizzle memilih migrasi berdasarkan `when` TERBESAR yang sudah
    // tercatat di database, bukan berdasarkan idx. Kalau `when` sebuah
    // migrasi lebih kecil daripada pendahulunya, ia akan dilewati diam-diam
    // — tanpa galat, tanpa jejak di log mana pun.
    const urut = [...jurnal.entries].sort((a, b) => a.idx - b.idx);
    for (let i = 1; i < urut.length; i += 1) {
      expect(
        urut[i].when,
        `${urut[i].tag} punya "when" lebih kecil daripada ${urut[i - 1].tag}`,
      ).toBeGreaterThan(urut[i - 1].when);
    }
  });

  it("tidak ada migrasi yang kosong", () => {
    for (const f of berkas) {
      const isi = readFileSync(path.join(DIR, f), "utf8").trim();
      expect(isi.length, `${f} kosong`).toBeGreaterThan(0);
    }
  });
});
