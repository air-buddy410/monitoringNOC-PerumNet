// Menghitung laju dari counter kumulatif RouterOS.
//
// Murni: tidak menyentuh jaringan, tidak menyentuh database, tidak memanggil
// jam. Seluruh waktu masuk sebagai argumen supaya tiap aturan di sini bisa
// diuji tanpa menunggu apa pun.

/** Satu pembacaan counter pada satu titik waktu. */
export interface Cuplikan {
  pada: Date;
  rxByte: bigint;
  txByte: bigint;
}

export interface Laju {
  rxBps: number;
  txBps: number;
  /** Jarak waktu nyata antar cuplikan — bukan interval yang diasumsikan. */
  dtMs: number;
}

export type SebabTolak =
  | "PERTAMA"
  | "MUNDUR"
  | "TERLALU_RAPAT"
  | "LUBANG"
  | "RESET"
  | "TIDAK_MASUK_AKAL";

export type HasilLaju =
  | { ok: true; laju: Laju }
  | { ok: false; sebab: SebabTolak };

/** Di bawah ini, satu paket jitter jadi galat puluhan Mbps. */
export const MIN_JEDA_MS = 2_000;
/** Di atas ini, satu titik rata-rata akan MENUTUPI lubangnya. */
export const MAX_JEDA_MS = 6 * 60_000;
/** Batas kewarasan saat kapasitas port tidak diketahui. */
export const BATAS_BPS_MUTLAK = 400e9;

/**
 * Mengubah teks counter jadi BigInt.
 *
 * **Wajib BigInt, bukan Number.** Counter uplink 2.826 Mbps melewati
 * `Number.MAX_SAFE_INTEGER` setelah ±295 hari uptime; sesudah itu dua
 * pembacaan berdekatan membulat ke angka yang SAMA, selisihnya jadi 0, dan
 * grafik trafik turun ke nol tanpa satu pun galat. Router yang paling lama
 * hidup justru yang paling mungkin kena.
 *
 * Menolak yang bukan digit murni: `BigInt("")` menghasilkan `0n` — sebuah
 * nilai yang terlihat sah dan akan dibaca sebagai counter yang di-reset.
 */
export function parseCounter(raw: string | null | undefined): bigint | null {
  const teks = (raw ?? "").trim();
  if (!/^\d+$/.test(teks)) return null;
  try {
    return BigInt(teks);
  } catch {
    return null;
  }
}

/**
 * Laju antara dua cuplikan, atau alasan kenapa tidak ada laju yang sah.
 *
 * Yang ditolak TIDAK menghasilkan titik — bukan titik bernilai nol. Nol yang
 * dikarang terbaca sebagai "trafik berhenti", dan itu gangguan besar yang
 * tidak pernah terjadi.
 */
export function hitungLaju(
  sebelum: Cuplikan | null,
  sekarang: Cuplikan,
  opts?: { kapasitasBps?: number | null },
): HasilLaju {
  if (!sebelum) return { ok: false, sebab: "PERTAMA" };

  const dtMs = sekarang.pada.getTime() - sebelum.pada.getTime();
  if (dtMs <= 0) return { ok: false, sebab: "MUNDUR" };
  if (dtMs < MIN_JEDA_MS) return { ok: false, sebab: "TERLALU_RAPAT" };
  if (dtMs > MAX_JEDA_MS) return { ok: false, sebab: "LUBANG" };

  // Counter yang TURUN selalu berarti reset — reboot, `reset-counters`, atau
  // interface dibuat ulang. TIDAK PERNAH wrap: counter 64-bit butuh ratusan
  // tahun untuk berputar. Kode yang "menangani wrap" akan mengubah tiap
  // reboot jadi lonjakan 18 exabyte.
  //
  // Satu arah turun membatalkan KEDUANYA: reset itu peristiwa perangkat, dan
  // arah yang kebetulan masih naik pun sudah tidak sebanding dengan pasangan
  // cuplikannya.
  if (sekarang.rxByte < sebelum.rxByte || sekarang.txByte < sebelum.txByte) {
    return { ok: false, sebab: "RESET" };
  }

  // Selisihnya kecil, jadi aman turun ke Number SETELAH dikurangkan.
  const rxBps = (Number(sekarang.rxByte - sebelum.rxByte) * 8_000) / dtMs;
  const txBps = (Number(sekarang.txByte - sebelum.txByte) * 8_000) / dtMs;

  const batas = opts?.kapasitasBps ? opts.kapasitasBps * 1.5 : BATAS_BPS_MUTLAK;
  if (rxBps > batas || txBps > batas) {
    return { ok: false, sebab: "TIDAK_MASUK_AKAL" };
  }

  return { ok: true, laju: { rxBps, txBps, dtMs } };
}
