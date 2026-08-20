// Deteksi gangguan massal.
//
// Pertanyaannya bukan "berapa pelanggan padam" melainkan "apa yang harus
// didatangi". Alasannya sudah dibayar CRM dan layak disalin apa adanya:
// 39 padam tersebar di 39 ODP = 39 modem dicabut, tidak ada yang perlu
// didatangi. 39 padam dengan 20 di antaranya pada SATU ODP = jalur putus,
// satu teknisi menyelesaikan 20 keluhan. Angka totalnya sama, tindakannya
// beda.
//
// Karena itu keluarannya bertingkat, dan tingkat yang lebih tinggi MENELAN
// yang lebih rendah: kalau satu situs padam, 40 alarm ODP di bawahnya bukan
// 40 informasi — itu satu informasi yang diulang 40 kali.

import { describe, expect, it } from "vitest";
import { AMBANG_PADAM, kelompokkanPadam } from "@/server/outage";

const pel = (
  username: string,
  odpId: string,
  oltId: string | null = "olt1",
  siteId: string | null = "situs1",
) => ({
  username,
  odpId,
  odpCode: odpId.toUpperCase(),
  oltId,
  oltName: oltId ? `OLT ${oltId}` : null,
  siteId,
  siteName: siteId ? `Situs ${siteId}` : null,
});

/** Semua hadir kecuali yang disebut. */
const hadirKecuali = (semua: { username: string }[], hilang: string[]) =>
  new Set(semua.map((p) => p.username).filter((u) => !hilang.includes(u)));

describe("ambang", () => {
  it("sama dengan yang dipakai CRM, dan itu disengaja", () => {
    // Dua aplikasi yang menyebut angka berbeda untuk gangguan yang SAMA
    // membuat orang berhenti mempercayai keduanya.
    expect(AMBANG_PADAM).toBe(2);
  });
});

describe("tingkat ODP", () => {
  const semua = [pel("a", "odp1"), pel("b", "odp1"), pel("c", "odp1"), pel("d", "odp2")];

  it("satu pelanggan padam BUKAN gangguan — itu modem dicabut", () => {
    expect(kelompokkanPadam(semua, hadirKecuali(semua, ["a"]))).toEqual([]);
  });

  it("dua pada ODP yang sama = gerombol", () => {
    const hasil = kelompokkanPadam(semua, hadirKecuali(semua, ["a", "b"]));
    expect(hasil).toHaveLength(1);
    expect(hasil[0]).toMatchObject({ level: "ODP", id: "odp1", padam: 2, total: 3 });
  });

  it("dua padam di ODP BERBEDA bukan gerombol — itu dua kejadian terpisah", () => {
    // Datanya sengaja seukuran situs sungguhan. Dengan hanya 4 pelanggan,
    // 2 padam memang benar-benar separuh situs — dan melaporkannya BUKAN
    // kesalahan. Aturan pecahan baru bermakna pada jumlah yang nyata, jadi
    // tesnya harus memakai jumlah yang nyata.
    const situsBesar = Array.from({ length: 20 }, (_, i) =>
      pel(`u${i}`, `odp${i % 5}`),
    );
    const hasil = kelompokkanPadam(situsBesar, hadirKecuali(situsBesar, ["u0", "u1"]));
    // u0 di odp0, u1 di odp1 — beda ODP, dan 2 dari 20 = 10%.
    expect(hasil).toEqual([]);
  });
});

describe("tingkat OLT dan situs menelan yang di bawahnya", () => {
  // Dua ODP di bawah satu OLT, empat pelanggan.
  const semua = [
    pel("a", "odp1"), pel("b", "odp1"),
    pel("c", "odp2"), pel("d", "odp2"),
  ];

  it("seluruh OLT padam → satu alarm OLT, BUKAN dua alarm ODP", () => {
    const hasil = kelompokkanPadam(semua, new Set());
    // Situs juga 100% padam, dan situs menelan OLT.
    expect(hasil).toHaveLength(1);
    expect(hasil[0]).toMatchObject({ level: "SITUS", padam: 4, total: 4 });
  });

  it("OLT padam sementara situs punya OLT lain yang sehat → alarm OLT", () => {
    const dengan2Olt = [
      ...semua,
      pel("e", "odp9", "olt2"), pel("f", "odp9", "olt2"), pel("g", "odp9", "olt2"),
      pel("h", "odp9", "olt2"), pel("i", "odp9", "olt2"),
    ];
    const hasil = kelompokkanPadam(dengan2Olt, hadirKecuali(dengan2Olt, ["a", "b", "c", "d"]));
    // 4 dari 9 padam = 44% situs → situs TIDAK menyala. OLT1 100% → menyala.
    expect(hasil).toHaveLength(1);
    expect(hasil[0]).toMatchObject({ level: "OLT", id: "olt1", padam: 4 });
  });

  it("separuh OLT padam belum tentu OLT-nya — kalau terkumpul di satu ODP, ODP yang disebut", () => {
    const hasil = kelompokkanPadam(semua, hadirKecuali(semua, ["a", "b"]));
    expect(hasil).toHaveLength(1);
    expect(hasil[0]).toMatchObject({ level: "ODP", id: "odp1" });
  });
});

describe("yang TIDAK boleh dihitung", () => {
  it("pelanggan tanpa OLT/situs tetap bisa jadi gerombol ODP", () => {
    const semua = [pel("a", "odp1", null, null), pel("b", "odp1", null, null)];
    const hasil = kelompokkanPadam(semua, new Set());
    expect(hasil[0]).toMatchObject({ level: "ODP", id: "odp1" });
  });

  it("daftar kosong tidak melahirkan gerombol", () => {
    expect(kelompokkanPadam([], new Set())).toEqual([]);
  });

  it("semua hadir → tidak ada gerombol", () => {
    const semua = [pel("a", "odp1"), pel("b", "odp1")];
    expect(kelompokkanPadam(semua, hadirKecuali(semua, []))).toEqual([]);
  });
});

describe("urutan dan isi", () => {
  it("terbanyak lebih dulu — yang paling banyak terdampak yang didatangi lebih dulu", () => {
    const semua = [
      pel("a", "odp1"), pel("b", "odp1"),
      pel("c", "odp2"), pel("d", "odp2"), pel("e", "odp2"),
      pel("f", "odp3", "olt2", "situs2"), pel("g", "odp3", "olt2", "situs2"),
      pel("h", "odp4", "olt2", "situs2"), pel("i", "odp4", "olt2", "situs2"),
      pel("j", "odp4", "olt2", "situs2"), pel("k", "odp4", "olt2", "situs2"),
    ];
    const hasil = kelompokkanPadam(semua, hadirKecuali(semua, ["a", "b", "c", "d", "e"]));
    expect(hasil[0].padam).toBeGreaterThanOrEqual(hasil.at(-1)!.padam);
  });

  it("membawa username supaya teknisi bisa memverifikasi di lapangan", () => {
    const semua = [pel("a", "odp1"), pel("b", "odp1")];
    const hasil = kelompokkanPadam(semua, new Set());
    expect(hasil[0].usernames.sort()).toEqual(["a", "b"]);
  });
});
