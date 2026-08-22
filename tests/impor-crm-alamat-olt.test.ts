// Importir CRM tidak boleh menimpa alamat OLT.
//
// CRM menyimpan alamat jalur port-forwarding ALUS (172.30.10.x). Portal ini
// hidup SATU JARINGAN dengan OLT-nya, jadi alamat itu tidak pernah bisa
// dihubunginya — diuji dari VPS 22 Agustus 2026: 172.30.10.6 port 23, 231,
// dan 1024 tidak menjawab satu pun, sedangkan keenam alamat LAN menjawab
// semua.
//
// Sampai tanggal itu importir menimpanya tiap kali dijalankan. Akibatnya
// konsol perangkat gagal untuk 5 dari 6 OLT, dan gagalnya berupa waktu-habis
// — bukan pesan yang bisa dijelaskan siapa pun. Yang membuatnya bertahan
// berbulan-bulan: perbaikannya SUDAH ditulis di OPERATIONS.md §11.2 pada 20
// Agustus, tapi tidak pernah masuk database, dan tidak ada yang memeriksa
// selisih antara dokumen dan kenyataan.
//
// Tes ini memeriksa sumbernya, bukan perilakunya saat jalan: skrip impor
// menyentuh dua database sungguhan dan tidak bisa dijalankan di sini. Yang
// dijaga cukup sempit untuk berguna — pernyataan UPDATE-nya tidak boleh
// menyebut kedua kolom itu.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const skrip = readFileSync(
  path.resolve(__dirname, "..", "scripts", "impor-dari-crm.ts"),
  "utf8",
);

/** Pernyataan UPDATE terhadap olt_devices, apa pun bentuk barisnya. */
function updateOlt() {
  const cocok = skrip.match(/UPDATE olt_devices SET[^`]*/g) ?? [];
  return cocok;
}

describe("importir CRM dan alamat OLT", () => {
  it("masih ada pernyataan UPDATE olt_devices — kalau hilang, tes ini tidak menjaga apa pun", () => {
    // Penjaga bagi penjaganya: kalau skripnya ditulis ulang dan pola ini
    // tidak cocok lagi, tes di bawah akan hijau tanpa memeriksa apa pun.
    expect(updateOlt()).toHaveLength(1);
  });

  it("tidak menimpa management_ip", () => {
    expect(updateOlt()[0]).not.toMatch(/management_ip/);
  });

  it("tidak menimpa telnet_port", () => {
    expect(updateOlt()[0]).not.toMatch(/telnet_port/);
  });

  it("tetap memperbarui vendor, model, dan credential_ref", () => {
    // Ketiganya memang milik CRM dan tidak bergantung pada jaringan tempat
    // portal berdiri — jangan ikut dibekukan.
    for (const kolom of ["vendor", "model", "credential_ref"]) {
      expect(updateOlt()[0]).toMatch(new RegExp(kolom));
    }
  });

  it("OLT baru tetap memakai alamat CRM, tapi memperingatkan", () => {
    // Tidak ada sumber lain untuk OLT yang belum pernah ada di portal ini.
    // Yang penting: orang yang menjalankan impor diberi tahu bahwa alamatnya
    // perlu diperiksa, bukan dibiarkan menyangka sudah benar.
    expect(skrip).toMatch(/INSERT INTO olt_devices[\s\S]*?management_ip/);
    expect(skrip).toMatch(/OLT baru .* memakai alamat CRM/);
  });
});
