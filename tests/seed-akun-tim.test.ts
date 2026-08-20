// Penguraian daftar akun tim.
//
// Dua hal yang dijaga: nama orang yang memuat spasi tidak boleh pecah jadi
// beberapa kolom, dan berkas daftar yang berada DI DALAM repo harus ditolak —
// repo ini publik, dan daftar nama pegawai tidak boleh ikut ter-commit.

import { describe, expect, it } from "vitest";
import { diDalamRepo, uraikanDaftar } from "../scripts/seed-akun-tim-lib";

describe("uraikanDaftar", () => {
  it("memisah dengan TAB supaya nama bersapasi tetap utuh", () => {
    const hasil = uraikanDaftar("orang@contoh.id\tI Made Nama Panjang\tnoc");
    expect(hasil).toEqual([
      { email: "orang@contoh.id", nama: "I Made Nama Panjang", peran: "noc", darurat: false },
    ]);
  });

  it("melewati baris kosong dan komentar", () => {
    const hasil = uraikanDaftar(
      "# ini komentar\n\norang@contoh.id\tNama\tadmin\n   \n",
    );
    expect(hasil).toHaveLength(1);
  });

  it("menandai akun darurat lewat kolom keempat", () => {
    const [b] = uraikanDaftar("admin@contoh.id\tAdmin\tadmin\tdarurat");
    expect(b.darurat).toBe(true);
  });

  it("menolak peran yang tidak dikenal, bukan mendiamkannya", () => {
    expect(() => uraikanDaftar("orang@contoh.id\tNama\tsuperuser")).toThrow(/superuser/);
  });

  it("menolak alamat yang bukan email", () => {
    expect(() => uraikanDaftar("bukan-email\tNama\tnoc")).toThrow(/bukan alamat email/);
  });

  it("menolak baris yang dipisah spasi, bukan diam-diam salah baca", () => {
    expect(() => uraikanDaftar("orang@contoh.id Nama noc")).toThrow(/dipisah TAB/);
  });

  it("menurunkan email jadi huruf kecil — pencocokan login tidak peka huruf", () => {
    const [b] = uraikanDaftar("Orang@Contoh.ID\tNama\tnoc");
    expect(b.email).toBe("orang@contoh.id");
  });
});

describe("diDalamRepo", () => {
  it("menolak berkas di dalam repo — repo ini publik", () => {
    expect(diDalamRepo("/repo/daftar.tsv", "/repo")).toBe(true);
    expect(diDalamRepo("/repo/scripts/daftar.tsv", "/repo")).toBe(true);
  });

  it("mengizinkan berkas di luar repo", () => {
    expect(diDalamRepo("/home/orang/daftar.tsv", "/repo")).toBe(false);
  });

  it("tidak tertipu nama folder yang berawalan sama", () => {
    expect(diDalamRepo("/repo-lain/daftar.tsv", "/repo")).toBe(false);
  });
});
