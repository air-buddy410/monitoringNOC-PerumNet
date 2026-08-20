// Menghitung laju dari counter kumulatif MikroTik.
//
// RouterOS hanya memberi `rx-byte`/`tx-byte` — angka yang terus naik sejak
// perangkat menyala. Lajunya harus diselisihkan sendiri, dan di situlah
// seluruh cara untuk salah berkumpul.
//
// Yang paling berbahaya BUKAN yang meledak, melainkan yang diam:
// counter datang sebagai STRING, dan `Number("9007199254740993")` menghasilkan
// 9007199254740992. Pada uplink 2.826 Mbps (353 MB/detik), counter melewati
// Number.MAX_SAFE_INTEGER setelah ±295 hari uptime. Sesudah itu selisih dua
// pembacaan yang berdekatan membulat ke angka yang sama, deltanya jadi 0, dan
// grafik trafik pelan-pelan turun ke nol tanpa satu pun galat. Router yang
// uptime-nya panjang justru yang paling mungkin kena.

import { describe, expect, it } from "vitest";
import { hitungLaju, parseCounter } from "@/server/traffic-rate";

// Literal `123n` butuh target ES2020; tsconfig repo ini ES2017, jadi dipakai
// `BigInt("123")`. Runtime-nya sama — yang dibatasi hanya sintaksisnya.

const c = (rx: string, tx: string, pada: string) => ({
  pada: new Date(pada),
  rxByte: BigInt(rx),
  txByte: BigInt(tx),
});

const T0 = "2026-08-20T10:00:00.000Z";
const T10 = "2026-08-20T10:00:10.000Z";

describe("parseCounter", () => {
  it("menerima angka desimal murni", () => {
    expect(parseCounter("2542627805460953")).toBe(BigInt("2542627805460953"));
    expect(parseCounter("0")).toBe(BigInt("0"));
  });

  it("menolak yang bukan angka — teks kosong diam-diam jadi nol, dan itu berbahaya", () => {
    for (const buruk of ["", "  ", "12.5", "abc", "-5", "1e9", null, undefined]) {
      expect(parseCounter(buruk as string), String(buruk)).toBeNull();
    }
  });

  it("spasi di tepi dibuang", () => {
    expect(parseCounter("  123  ")).toBe(BigInt("123"));
  });
});

describe("hitungLaju", () => {
  it("kasus normal", () => {
    const h = hitungLaju(c("1000000000", "0", T0), c("1012500000", "0", T10));
    expect(h.ok).toBe(true);
    if (h.ok) expect(h.laju.rxBps).toBe(10_000_000);
  });

  it("PRESISI: selisih 6 byte di atas MAX_SAFE_INTEGER tetap terbaca", () => {
    // Ini tes yang membuktikan dirinya berguna. Implementasi yang memakai
    // Number() lulus SEMUA kasus lain dan gagal hanya di sini — dengan
    // menghasilkan 0, bukan galat.
    const h = hitungLaju(
      c("9007199254740993", "0", T0),
      c("9007199254740999", "0", T10),
    );
    expect(h.ok).toBe(true);
    if (h.ok) expect(h.laju.rxBps).toBeCloseTo(4.8, 5);
  });

  it("cuplikan pertama tidak menghasilkan laju — bukan nol", () => {
    const h = hitungLaju(null, c("1000", "1000", T0));
    expect(h).toEqual({ ok: false, sebab: "PERTAMA" });
  });

  it("counter turun = RESET, bukan wrap — dan bukan lonjakan 2^64", () => {
    // Counter 64-bit butuh ~584 tahun untuk wrap pada 100 Gbps. Nilai yang
    // turun SELALU berarti reboot atau reset-counters. Kode yang "menangani
    // wrap" akan mengubah tiap reboot jadi lonjakan 18 exabyte.
    const h = hitungLaju(c("5000000000", "0", T0), c("12000", "0", T10));
    expect(h).toEqual({ ok: false, sebab: "RESET" });
  });

  it("reset pada SATU arah membatalkan keduanya", () => {
    // Reset itu peristiwa tingkat perangkat. Menerbitkan arah yang kebetulan
    // masih naik berarti menerbitkan titik yang dihitung dari pasangan
    // cuplikan yang sudah tidak sebanding.
    const h = hitungLaju(c("5000000000", "900", T0), c("12000", "1000", T10));
    expect(h).toEqual({ ok: false, sebab: "RESET" });
  });

  it("jam mundur ditolak", () => {
    const h = hitungLaju(c("1000", "0", T10), c("2000", "0", T0));
    expect(h).toEqual({ ok: false, sebab: "MUNDUR" });
  });

  it("dua pembacaan terlalu rapat ditolak", () => {
    const h = hitungLaju(
      c("1000", "0", T0),
      c("2000", "0", "2026-08-20T10:00:00.900Z"),
    );
    expect(h).toEqual({ ok: false, sebab: "TERLALU_RAPAT" });
  });

  it("lubang panjang ditolak — rata-rata yang mulus MENUTUPI lubangnya", () => {
    // Rata-rata 20 menit itu benar secara aritmetika, tapi digambar sebagai
    // satu titik ia menyembunyikan bahwa collector-nya mati. Garis yang putus
    // mengatakan yang sebenarnya.
    const h = hitungLaju(c("1000", "0", T0), c("2000", "0", "2026-08-20T10:20:00.000Z"));
    expect(h).toEqual({ ok: false, sebab: "LUBANG" });
  });

  it("laju yang mustahil ditolak bila kapasitas diketahui", () => {
    const h = hitungLaju(
      c("0", "0", T0),
      c("500000000000", "0", T10),
      { kapasitasBps: 10e9 },
    );
    expect(h).toEqual({ ok: false, sebab: "TIDAK_MASUK_AKAL" });
  });

  it("tanpa kapasitas, batas kewarasan tetap ada", () => {
    const h = hitungLaju(c("0", "0", T0), c("999999999999999", "0", T10));
    expect(h.ok).toBe(false);
  });

  it("trafik nol yang JUJUR tetap diterbitkan", () => {
    // Port mati yang counternya tidak bergerak adalah 0 bps yang benar —
    // beda dari "tidak ada data", dan layar harus bisa membedakannya.
    const h = hitungLaju(c("777", "777", T0), c("777", "777", T10));
    expect(h.ok).toBe(true);
    if (h.ok) {
      expect(h.laju.rxBps).toBe(0);
      expect(h.laju.txBps).toBe(0);
    }
  });

  it("membawa dtMs supaya jitter tidak jadi kesalahan", () => {
    // Tick yang meleset jadi 13 detik menghasilkan rata-rata 13 detik yang
    // BENAR, karena pembaginya waktu nyata — bukan 10.000 yang diasumsikan.
    const h = hitungLaju(c("0", "0", T0), c("13000000", "0", "2026-08-20T10:00:13.000Z"));
    expect(h.ok).toBe(true);
    if (h.ok) {
      expect(h.laju.dtMs).toBe(13_000);
      expect(h.laju.rxBps).toBe(8_000_000);
    }
  });
});
