// Penguraia daftar ONU — dan penjaga terhadap kehilangan yang tidak bersuara.
//
// Contoh di berkas ini DISALIN dari perangkat sungguhan 22 Agustus 2026
// (ZTE-C300-102-Pesagi dan ZTE-C600-100-Kecicang), termasuk urutan
// backspace-spasi-backspace yang dikirim OLT untuk menghapus `--More--`.
// JANGAN "dirapikan": bentuk itulah yang membuat 15 dari 356 ONU raib tanpa
// satu galat pun sebelum diperbaiki.

import { describe, expect, it } from "vitest";
import { bersihkanHalaman, SISA_HAPUS } from "@/server/olt-cli";
import { perintahOnu, uraiOnuZte } from "@/server/olt-onu";

/** Urutan hapus yang benar-benar dikirim OLT: 8 32 8, delapan kali. */
const HAPUS = "\x08 \x08".repeat(8);

const C300 = `
ZXAN#
OnuIndex   Admin State  OMCC State  Phase State  Channel
--------------------------------------------------------------
1/2/1:1     enable       enable      working      1(GPON)
1/2/1:2     enable       enable      working      1(GPON)
${HAPUS}1/2/3:6     enable       enable      working      1(GPON)
1/2/3:7     enable       disable     LOS          1(GPON)
1/2/4:9     enable       enable      DyingGasp    1(GPON)
`;

// C600 memakai kapitalisasi lain DAN kolom kelima yang berbeda.
const C600 = `
*********************************************************
Welcome to TITAN series OLT of ZTE Corporation
*********************************************************
Login at 17:21:44 08-22-2026 from 192.168.100.1 through TELNET.
ZXAN#show gpon onu state
OnuIndex     Admin state  OMCC state  Phase state  Speed mode
-----------------------------------------------------------------
1/1/1:1      enable       enable      working      GPON
1/1/1:2      enable       enable      syncMib      GPON
`;

describe("uraiOnuZte", () => {
  it("membaca kolom-kolomnya dan memecah indeks jadi port PON + id", () => {
    const h = uraiOnuZte(C300);
    const satu = h.baris[0];
    expect(satu.indeks).toBe("1/2/1:1");
    expect(satu.ponPort).toBe("1/2/1");
    expect(satu.onuId).toBe(1);
    expect(satu.adminState).toBe("enable");
    expect(satu.omccState).toBe("enable");
    expect(satu.phaseState).toBe("working");
    expect(satu.keterangan).toBe("1(GPON)");
    expect(satu.sehat).toBe(true);
  });

  it("baris sesudah --More-- TIDAK hilang", () => {
    // Inti seluruh berkas ini. Urutan `\x08 \x08` bukan whitespace menurut
    // Unicode, jadi `trim()` tidak menyentuhnya dan barisnya berhenti diawali
    // indeks ONU. Diukur di produksi: 15 dari 356 ONU raib karena ini.
    const h = uraiOnuZte(C300);
    expect(h.baris.map((b) => b.indeks)).toContain("1/2/3:6");
    expect(h.baris).toHaveLength(5);
    expect(h.takTerurai).toEqual([]);
  });

  it("menghitung ringkasan per phase state", () => {
    const h = uraiOnuZte(C300);
    expect(h.ringkas).toEqual({ working: 3, LOS: 1, DyingGasp: 1 });
  });

  it("hanya `working` yang dianggap sehat", () => {
    const h = uraiOnuZte(C300);
    const takSehat = h.baris.filter((b) => !b.sehat).map((b) => b.phaseState);
    // LOS dan DyingGasp dua-duanya harus terhitung tidak sehat — itu yang
    // dicari orang saat membuka layar ini.
    expect(takSehat.sort()).toEqual(["DyingGasp", "LOS"]);
  });

  it("C600 terurai walau header dan kolom kelimanya berbeda", () => {
    // C300 menulis `Channel`, C600 menulis `Speed mode`; kapitalisasinya juga
    // berbeda. Penguraia yang berpatokan pada header akan diam di salah satu.
    const h = uraiOnuZte(C600);
    expect(h.baris).toHaveLength(2);
    expect(h.baris[1].phaseState).toBe("syncMib");
    expect(h.baris[0].keterangan).toBe("GPON");
    expect(h.takTerurai).toEqual([]);
  });

  it("spanduk login, prompt, dan garis pemisah tidak jadi baris ONU", () => {
    const h = uraiOnuZte(C600);
    expect(h.baris.every((b) => /^\d+\/\d+\/\d+:\d+$/.test(b.indeks))).toBe(true);
  });

  it("baris rusak DILAPORKAN, bukan dibuang diam-diam", () => {
    // Sesi yang terputus di tengah meninggalkan baris tak lengkap. Penguraia
    // yang melewatkannya menghasilkan daftar yang terlihat utuh padahal tidak.
    const h = uraiOnuZte("1/2/1:1 enable enable working 1(GPON)\n1/2/1:2 enable\n");
    expect(h.baris).toHaveLength(1);
    expect(h.takTerurai).toEqual(["1/2/1:2 enable"]);
  });

  it("keluaran kosong menghasilkan hasil kosong, bukan lemparan", () => {
    expect(uraiOnuZte("")).toEqual({ baris: [], ringkas: {}, takTerurai: [] });
  });
});

describe("bersihkanHalaman", () => {
  it("membuang urutan hapus terminal, yang trim() tidak bisa", () => {
    const kotor = `${HAPUS}1/2/3:6 enable`;
    expect(kotor.trim().startsWith("1/2/3:6")).toBe(false);
    expect(bersihkanHalaman(kotor)).toBe("1/2/3:6 enable");
  });

  it("polanya memakai \\x08, bukan \\b — batas kata tidak cocok apa pun", () => {
    // Jebakan regex: `\b` di dalam pola berarti batas kata. Kalau tertulis
    // begitu, polanya diam-diam tidak membuang apa pun dan tesnya tetap hijau
    // untuk alasan yang salah.
    expect(SISA_HAPUS.source).toContain("\\x08");
    expect("a\x08b".replace(SISA_HAPUS, "")).toBe("ab");
  });
});

describe("perintahOnu", () => {
  it("ZTE punya perintahnya", () => {
    expect(perintahOnu("ZTE")).toBe("show gpon onu state");
  });

  it("HSGQ TIDAK punya — dan itu jawaban, bukan kelalaian", () => {
    // HSGQ-G008 tidak punya daftar ONU di vty-nya sama sekali; ditanyakan
    // langsung ke perangkatnya. Menebak perintah untuknya hanya menghasilkan
    // "Unknown command" yang terlihat seperti kegagalan kita.
    expect(perintahOnu("HSGQ")).toBeNull();
    expect(perintahOnu(null)).toBeNull();
  });
});
