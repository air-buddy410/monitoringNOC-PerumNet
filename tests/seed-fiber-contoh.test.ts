// Topologi contoh — yang dijaga di sini bukan bentuknya, melainkan
// SATU sifat: setiap baris yang dibuat skrip ini bisa dikenali sebagai
// contoh, dan bisa dihapus tanpa menyentuh apa pun yang nyata.
//
// Kalau satu saja kode lolos tanpa awalan `CONTOH-`, ia jadi tidak bisa
// dibedakan dari catatan lapangan — `--hapus` akan melewatinya, dan suatu
// hari ada yang membaca kabel karangan itu sebagai kabel yang benar-benar
// terpasang. Itu kesalahan yang sama dengan laporan SLA yang dulu menanam
// angka karangan ke produksi: yang berbahaya bukan datanya palsu, melainkan
// tidak ada yang bisa tahu bahwa ia palsu.

import { describe, expect, it } from "vitest";
import {
  AWALAN,
  CLOSURE,
  KABEL,
  ODP,
  OTB,
  SPLITTER,
  milikContoh,
  posisiDalamTabung,
  tabungUntuk,
} from "../scripts/seed-fiber-contoh-lib";

describe("penanda data contoh", () => {
  it("SETIAP kode yang akan dibuat berawalan CONTOH-", () => {
    const semua = [
      OTB.code,
      CLOSURE.code,
      SPLITTER.code,
      ...KABEL.map((k) => k.code),
      ...ODP.map((o) => o.code),
    ];
    expect(semua.length).toBeGreaterThan(5);
    for (const kode of semua) {
      expect(kode, `${kode} tidak berawalan ${AWALAN}`).toMatch(new RegExp(`^${AWALAN}`));
    }
  });

  it("awalannya tidak kosong dan tidak sepele", () => {
    // Awalan kosong akan membuat `--hapus` mencocokkan SEMUA baris.
    expect(AWALAN.length).toBeGreaterThan(3);
    expect(milikContoh("")).toBe(false);
    expect(milikContoh(null)).toBe(false);
    expect(milikContoh(undefined)).toBe(false);
  });

  it("kode nyata tidak pernah dianggap milik contoh", () => {
    for (const nyata of ["KBL-FDR-01", "OTB-POP-001", "MS-1", "ODP-1", "contoh-kbl"]) {
      expect(milikContoh(nyata), `${nyata} tidak boleh dianggap contoh`).toBe(false);
    }
    expect(milikContoh(`${AWALAN}KBL-01`)).toBe(true);
  });
});

describe("penomoran tabung", () => {
  it("core 1–12 ada di tabung 1, core 13 mulai tabung 2", () => {
    expect(tabungUntuk(1, 12)).toBe(1);
    expect(tabungUntuk(12, 12)).toBe(1);
    expect(tabungUntuk(13, 12)).toBe(2);
    expect(tabungUntuk(24, 12)).toBe(2);
  });

  it("posisi di dalam tabung berulang 1–12", () => {
    expect(posisiDalamTabung(1, 12)).toBe(1);
    expect(posisiDalamTabung(12, 12)).toBe(12);
    expect(posisiDalamTabung(13, 12)).toBe(1);
  });

  it("kabel 144 core / 12 tabung menghasilkan 12 tabung penuh", () => {
    // Bentuk `Alokasi Core 144` yang sebenarnya.
    const tabung = new Set<number>();
    for (let c = 1; c <= 144; c += 1) tabung.add(tabungUntuk(c, 12));
    expect(tabung.size).toBe(12);
    expect(posisiDalamTabung(144, 12)).toBe(12);
  });

  it("tabung + posisi menunjuk core yang unik — pasangan itu tidak pernah berulang", () => {
    // Sifat inilah yang belum bisa ditegakkan `fiber_cores` (lihat
    // docs/SUMBER-DATA-LAPANGAN.md §4), dan justru kesalahan yang sudah ada
    // di sheet lapangan: TUBE 5 CORE 5 muncul dua kali.
    const terlihat = new Set<string>();
    for (let c = 1; c <= 144; c += 1) {
      const k = `${tabungUntuk(c, 12)}#${posisiDalamTabung(c, 12)}`;
      expect(terlihat.has(k), `pasangan ${k} berulang`).toBe(false);
      terlihat.add(k);
    }
    expect(terlihat.size).toBe(144);
  });
});
