// Pemangkas muatan layar TV — sengaja BEBAS database.
//
// Berkas ini tidak mengimpor apa pun yang hidup saat dijalankan (`import type`
// saja), supaya tesnya bisa menjalankan pemangkas yang sesungguhnya tanpa
// menyalakan Postgres. Penjaga yang terlalu mahal untuk dijalankan akan
// berhenti dijalankan.
//
// Yang dijaga di sini: layar TV berdiri di ruangan yang orang luar bisa
// masuki, dan tautannya bisa bocor. Angka boleh tampil; identitas tidak.

import type { RingkasanPadam, TingkatPadam } from "@/server/outage";

/** Gerombolan padam TANPA daftar username. */
export interface PadamTv {
  level: TingkatPadam;
  id: string;
  name: string;
  padam: number;
  total: number;
}

export interface RingkasanPadamTv {
  clusters: PadamTv[];
  padamTotal: number;
  padamTersebar: number;
  aktifTotal: number;
}

/**
 * Memangkas ringkasan padam untuk layar terbuka: angkanya ikut, daftar
 * usernamenya TIDAK.
 *
 * Disalin kolom per kolom, BUKAN disebar dengan `...c`. Sebaran akan membawa
 * kembali kolom apa pun yang ditambahkan di hulu — persis cara `usernames`
 * sampai ke layar untuk pertama kalinya.
 */
export function rapikanPadam(padam: RingkasanPadam): RingkasanPadamTv {
  return {
    clusters: padam.clusters.map((c) => ({
      level: c.level,
      id: c.id,
      name: c.name,
      padam: c.padam,
      total: c.total,
    })),
    padamTotal: padam.padamTotal,
    padamTersebar: padam.padamTersebar,
    aktifTotal: padam.aktifTotal,
  };
}
