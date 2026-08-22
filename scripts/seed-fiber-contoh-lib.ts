// Bentuk topologi contoh — dipisah dari skripnya supaya bisa diuji tanpa
// menyentuh database.

/**
 * Awalan WAJIB untuk setiap baris yang dibuat skrip ini.
 *
 * Ini satu-satunya hal yang memisahkan data contoh dari catatan lapangan
 * sungguhan, dan seluruh keamanan penghapusan bergantung padanya. Data contoh
 * yang tidak bisa dibedakan dari data nyata akan dibaca sebagai kabel yang
 * benar-benar terpasang — dan itu kesalahan yang sama dengan laporan SLA yang
 * dulu menanam angka karangan ke produksi.
 *
 * Jangan pernah dilonggarkan, dan jangan pernah dipakai untuk kode kabel
 * sungguhan.
 */
export const AWALAN = "CONTOH-";

export const CATATAN =
  "DATA CONTOH — dibuat scripts/seed-fiber-contoh.ts untuk menguji jalur OTB→kabel→closure→splitter→ODP. Bukan catatan lapangan. Hapus dengan --hapus.";

export interface RencanaKabel {
  code: string;
  category: "feeder" | "distribution";
  coreCount: number;
  lengthM: number;
  tubeSize: number;
}

/** Satu OTB LC/APC 4 tray × 24 port — bentuk yang sama dengan acuan visual. */
export const OTB = {
  code: `${AWALAN}OTB-POP-01`,
  name: "OTB POP Kecicang (contoh)",
  trayCount: 4,
  portsPerTray: 24,
  connectorType: "LC" as const,
  polish: "APC" as const,
};

/**
 * Tiga kabel yang meniru bentuk `Alokasi Core 144` versi kecil: feeder
 * bertube, lanjutan, lalu distribusi. Ukurannya sengaja tidak 144 core —
 * yang diuji bentuk jalurnya, bukan volumenya.
 */
export const KABEL: RencanaKabel[] = [
  { code: `${AWALAN}KBL-FDR-01`, category: "feeder", coreCount: 24, lengthM: 850, tubeSize: 12 },
  { code: `${AWALAN}KBL-FDR-02`, category: "feeder", coreCount: 24, lengthM: 1100, tubeSize: 12 },
  { code: `${AWALAN}KBL-DST-01`, category: "distribution", coreCount: 8, lengthM: 350, tubeSize: 8 },
];

export const CLOSURE = {
  code: `${AWALAN}CL-01`,
  name: "Closure Simpang (contoh)",
  latitude: -8.4521,
  longitude: 115.6033,
};

export const SPLITTER = { code: `${AWALAN}MS-01`, name: "MS Simpang (contoh)", capacity: 8 };
export const ODP = [
  { code: `${AWALAN}ODP-01`, name: "ODP Contoh Satu", capacity: 8 },
  { code: `${AWALAN}ODP-02`, name: "ODP Contoh Dua", capacity: 8 },
];

/**
 * Jalur yang dirakit: OTB port 1 → KBL-FDR-01 core 17 → closure → KBL-FDR-02
 * core 23 → MS → dua ODP.
 *
 * Silangan 17→23 dipilih dengan sengaja: ia kasus "nomor core berubah di
 * closure" yang jadi alasan seluruh modul ini ada, dan satu-satunya yang
 * tidak akan ketahuan salah kalau trace-nya diam-diam mengikuti nomor lama.
 */
export const JALUR = {
  otbPortGlobal: 1,
  coreFeederMasuk: 17,
  coreFeederKeluar: 23,
  coreDistribusi: [1, 2],
};

/** Nomor tabung untuk sebuah core, 1-basis. */
export function tabungUntuk(coreNumber: number, tubeSize: number) {
  return Math.floor((coreNumber - 1) / tubeSize) + 1;
}

/** Posisi core DI DALAM tabungnya, 1-basis. */
export function posisiDalamTabung(coreNumber: number, tubeSize: number) {
  return ((coreNumber - 1) % tubeSize) + 1;
}

/** Apakah sebuah kode aman dihapus skrip ini? */
export function milikContoh(code: string | null | undefined) {
  return typeof code === "string" && code.startsWith(AWALAN);
}
