// Muatan layar TV tidak boleh memuat inventaris jaringan maupun daftar
// pelanggan.
//
// Token TV bisa bocor — pemiliknya sudah menerima risiko itu secara sadar.
// Yang bocor karenanya tidak boleh berupa peta alamat perangkat: siapa pun
// yang memegang tautan itu tidak boleh sekaligus mendapat daftar IP
// manajemen, hostname, vendor, dan model seluruh jaringan.
//
// Tes ini menyisir bentuk muatannya, jadi ia menangkap "sekalian ikutkan
// saja" yang ditambahkan enam bulan lagi — bukan hanya keadaan hari ini.
//
// Dua lapis, karena satu saja tidak cukup: `npm test` menjalankan pemangkas
// yang sesungguhnya terhadap masukan yang kotor, sedangkan `npm run typecheck`
// menahan kolom baru yang menyelinap lewat tipe. Kebocoran di bawah ini hanya
// tertangkap oleh lapis typecheck — jadi jangan pernah menganggap `npm test`
// hijau berarti muatannya sudah aman.
//
// **Versi pertamanya tidak menangkap kebocoran yang nyata.** Ia hanya
// menyisir `PenandaTv` dan dua objek buatan tangan, jadi ia lolos sementara
// `outages.clusters[].usernames` — daftar username PPPoE pelanggan — mengalir
// utuh ke layar. Sekarang penyisirnya dijalankan terhadap objek bertipe
// `TvSnapshot` PENUH: menambah kolom di hulu memaksa contoh ini ikut berubah,
// dan kebocoran seperti itu berhenti di sini, bukan di ruang tamu kantor.

import { describe, expect, it } from "vitest";
import { rapikanPadam } from "@/server/tv-sanitize";
import type { PenandaTv, TvSnapshot } from "@/server/tv-snapshot";

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
  // Bukan perangkat, tapi sama pekanya: layar TV berdiri di ruangan yang
  // orang luar bisa masuki, dan tautannya bisa bocor.
  "usernames",
  "username",
  "customerName",
  "customer_name",
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

describe("muatan TV yang sebenarnya", () => {
  it("tidak memuat satu pun kunci terlarang", () => {
    // Bertipe `TvSnapshot` DENGAN SENGAJA: menambah kolom di hulu membuat
    // berkas ini gagal dikompilasi sampai seseorang memutuskan sadar apakah
    // kolom itu boleh tampil di layar terbuka.
    const contoh: TvSnapshot = {
      generatedAt: "2026-08-21T00:00:00.000Z",
      traffic: {
        generatedAt: "2026-08-21T00:00:00.000Z",
        sampledAt: "2026-08-21T00:00:00.000Z",
        ageSeconds: 12,
        stale: false,
        totals: { uplinkRxBps: 3_034_700_000, uplinkTxBps: 315_300_000 },
        interfaces: [
          {
            id: "if-1",
            ifName: "sfp-sfpplus1",
            label: "Uplink Utama",
            role: "uplink",
            siteId: null,
            rxBps: 3_034_700_000,
            txBps: 315_300_000,
            capacityBps: 10_000_000_000,
            utilizationPercent: 30.3,
            sampledAt: "2026-08-21T00:00:00.000Z",
            state: "ok",
            missingSince: null,
          },
        ],
      },
      devices: {
        total: 7,
        online: 7,
        warning: 0,
        offline: 0,
        markers: [
          { id: "aset-1", label: "OLT Kecicang", lat: -8.44, lng: 115.58, status: "online" },
        ],
      },
      outages: {
        clusters: [
          { level: "ODP", id: "odp-1", name: "ODP-KCC-012", padam: 6, total: 8 },
        ],
        padamTotal: 21,
        padamTersebar: 15,
        aktifTotal: 1715,
      },
      incidents: [
        {
          id: "insiden-1",
          deviceName: "OLT Kecicang",
          message: "PON 1/1 turun",
          severity: "critical",
          state: "active",
          triggeredAt: "2026-08-21T00:00:00.000Z",
        },
      ],
      pppoe: {
        current: 1603,
        lastRunStatus: "SUCCESS",
        trend: [{ t: "2026-08-21T00:00:00.000Z", count: 1603 }],
      },
    };

    const kunci = kunciBersarang(contoh);
    expect(TERLARANG.filter((k) => kunci.has(k))).toEqual([]);
  });

  it("pemangkas padam membuang daftar username, angkanya tetap", () => {
    // Regresi langsung terhadap kebocoran yang nyata sampai 21 Agustus 2026.
    // Masukannya sengaja berbentuk `RingkasanPadam` asli — LENGKAP dengan
    // username — supaya yang diuji adalah pemangkasnya, bukan contoh yang
    // kebetulan sudah bersih.
    const hasil = rapikanPadam({
      clusters: [
        {
          level: "SITUS",
          id: "situs-1",
          name: "Kecicang",
          padam: 2,
          total: 8,
          usernames: ["budi@perumnet", "wayan@perumnet"],
        },
      ],
      padamTotal: 21,
      padamTersebar: 19,
      aktifTotal: 1715,
    });

    expect(Object.keys(hasil.clusters[0]).sort()).toEqual([
      "id",
      "level",
      "name",
      "padam",
      "total",
    ]);
    expect(TERLARANG.filter((k) => kunciBersarang(hasil).has(k))).toEqual([]);
    // Angkanya harus selamat — memangkas bukan berarti melumpuhkan layarnya.
    expect(hasil.clusters[0].padam).toBe(2);
    expect(hasil.padamTotal).toBe(21);
    expect(hasil.aktifTotal).toBe(1715);
  });
});
