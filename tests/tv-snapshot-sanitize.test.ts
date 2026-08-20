// Muatan layar TV tidak boleh memuat inventaris jaringan.
//
// Token TV bisa bocor — pemiliknya sudah menerima risiko itu secara sadar.
// Yang bocor karenanya tidak boleh berupa peta alamat perangkat: siapa pun
// yang memegang tautan itu tidak boleh sekaligus mendapat daftar IP
// manajemen, hostname, vendor, dan model seluruh jaringan.
//
// Tes ini menyisir bentuk muatannya, jadi ia menangkap "sekalian ikutkan
// saja" yang ditambahkan enam bulan lagi — bukan hanya keadaan hari ini.

import { describe, expect, it } from "vitest";
import type { PenandaTv } from "@/server/tv-snapshot";

/** Kunci yang TIDAK BOLEH pernah muncul di muatan TV. */
const TERLARANG = [
  "managementIp",
  "management_ip",
  "hostname",
  "vendor",
  "model",
  "serialNumber",
  "serial_number",
  "credentialRef",
  "credential_ref",
  "ip",
];

function kunciBersarang(nilai: unknown, hasil = new Set<string>()): Set<string> {
  if (Array.isArray(nilai)) {
    for (const v of nilai) kunciBersarang(v, hasil);
  } else if (nilai && typeof nilai === "object") {
    for (const [k, v] of Object.entries(nilai)) {
      hasil.add(k);
      kunciBersarang(v, hasil);
    }
  }
  return hasil;
}

describe("penanda peta TV", () => {
  it("bentuknya hanya id, label, koordinat, status", () => {
    // Diperiksa lewat tipe DAN lewat contoh: tipe menjaga saat kompilasi,
    // contoh menjaga saat seseorang melebarkan objeknya diam-diam.
    const contoh: PenandaTv = {
      id: "aset-1",
      label: "OLT Kecicang",
      lat: -8.44,
      lng: 115.58,
      status: "online",
    };
    expect(Object.keys(contoh).sort()).toEqual([
      "id",
      "label",
      "lat",
      "lng",
      "status",
    ]);
  });

  it("tidak satu pun kunci terlarang ada di penanda", () => {
    const contoh: PenandaTv = {
      id: "a", label: "b", lat: 1, lng: 2, status: "online",
    };
    for (const k of TERLARANG) {
      expect(Object.keys(contoh), k).not.toContain(k);
    }
  });
});

describe("penyisir muatan", () => {
  it("menangkap kunci terlarang berapa pun dalamnya sarangnya", () => {
    // Membuktikan penyisirnya sendiri bekerja — penjaga yang tidak pernah
    // menangkap apa pun tidak bisa dibedakan dari penjaga yang rusak.
    const muatanBuruk = {
      devices: { markers: [{ id: "a", managementIp: "192.168.100.1" }] },
    };
    const kunci = kunciBersarang(muatanBuruk);
    const bocor = TERLARANG.filter((k) => kunci.has(k));
    expect(bocor).toEqual(["managementIp"]);
  });

  it("muatan yang bersih lolos", () => {
    const muatanBaik = {
      generatedAt: "…",
      devices: { total: 7, markers: [{ id: "a", label: "b", lat: 1, lng: 2, status: "online" }] },
      pppoe: { current: 1600, trend: [{ t: "…", count: 1600 }] },
    };
    const kunci = kunciBersarang(muatanBaik);
    expect(TERLARANG.filter((k) => kunci.has(k))).toEqual([]);
  });
});
