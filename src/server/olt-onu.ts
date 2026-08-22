// Daftar ONU dari konsol OLT — terurai, bukan gumpalan teks.
//
// Layar konsol sengaja menampilkan output MENTAH supaya jawaban perangkat bisa
// ditelusuri apa adanya, dan itu tetap benar. Tapi satu perintah
// `show gpon onu state` di ZTE-C300-102-Pesagi mengembalikan 21.589 karakter
// dalam 356 baris — tidak ada yang bisa mencari "mana yang LOS" di dalamnya.
//
// Modul ini menguraikannya jadi baris bertipe supaya bisa disaring dan
// dihitung. Ia TIDAK menggantikan konsol; ia layar kedua di sampingnya.

import { bersihkanHalaman } from "@/server/olt-cli";

/**
 * Perintah daftar ONU per vendor.
 *
 * **HSGQ sengaja tidak ada di sini, dan itu bukan kelalaian.** Ditanyakan
 * langsung ke HSGQ-100-Kecicang 22 Agustus 2026: `show ?` menjawab hanya
 * `history` dan `version`; sesudah `enable`, hanya `history`, `memory`,
 * `startup-config`, `version`. HSGQ-G008 tidak punya daftar ONU di vty-nya
 * sama sekali. Menebak sebuah perintah untuknya hanya menghasilkan
 * "Unknown command" yang terlihat seperti kegagalan kita.
 */
export const PERINTAH_ONU: Record<string, string> = {
  ZTE: "show gpon onu state",
};

export function perintahOnu(vendor: string | null): string | null {
  if (!vendor) return null;
  return PERINTAH_ONU[vendor.toUpperCase()] ?? null;
}

export interface BarisOnu {
  /** Indeks apa adanya dari perangkat, mis. `1/2/3:7`. */
  indeks: string;
  /** Bagian sebelum titik dua — port PON-nya, mis. `1/2/3`. */
  ponPort: string;
  /** Bagian sesudah titik dua. */
  onuId: number;
  adminState: string;
  omccState: string;
  /** `working` · `DyingGasp` · `LOS` · `syncMib` — diambil apa adanya. */
  phaseState: string;
  /**
   * Kolom kelima, apa adanya.
   *
   * Artinya BERBEDA antar-model dan karena itu tidak diberi nama: C300
   * menuliskannya `Channel` (`1(GPON)`), C600 menuliskannya `Speed mode`.
   * Memberinya satu nama berarti menyatakan keduanya hal yang sama.
   */
  keterangan: string;
  /** Turunan: hanya `working` yang dianggap sehat. */
  sehat: boolean;
}

export interface HasilUraiOnu {
  baris: BarisOnu[];
  /** Jumlah per `phaseState`, untuk ringkasan di kepala layar. */
  ringkas: Record<string, number>;
  /**
   * Baris yang MENGANDUNG indeks ONU tapi gagal diurai.
   *
   * Dilaporkan, bukan dibuang. Penguraia yang diam-diam melewatkan baris
   * rusak menghasilkan daftar yang terlihat lengkap padahal tidak — persis
   * yang terjadi sebelum sisa `--More--` dibersihkan: 15 dari 356 ONU raib
   * tanpa satu galat pun.
   */
  takTerurai: string[];
}

/** Indeks ONU: `<rak>/<slot>/<port>:<onu>`. */
const POLA_INDEKS = /\d+\/\d+\/\d+:\d+/;

/**
 * Satu baris ONU. Empat kolom pertama wajib, kolom kelima boleh kosong —
 * output yang terpotong di ujung sesi tidak boleh menjatuhkan seluruhnya.
 */
const POLA_BARIS =
  /^(\d+\/\d+\/\d+:\d+)\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/;

/**
 * Urai keluaran `show gpon onu state` (ZTE C300 dan C600).
 *
 * Header TIDAK dipakai sebagai patokan, karena keduanya berbeda:
 *
 * ```
 * C300: OnuIndex   Admin State  OMCC State  Phase State  Channel
 * C600: OnuIndex     Admin state  OMCC state  Phase state  Speed mode
 * ```
 *
 * Beda kapitalisasi DAN beda kolom kelima. Penguraia yang mencocokkan header
 * akan bekerja di satu model lalu diam di model lainnya.
 */
export function uraiOnuZte(keluaran: string): HasilUraiOnu {
  const baris: BarisOnu[] = [];
  const takTerurai: string[] = [];
  const ringkas: Record<string, number> = {};

  for (const mentah of bersihkanHalaman(keluaran).split("\n")) {
    const garis = mentah.trim();
    if (!garis) continue;

    const cocok = POLA_BARIS.exec(garis);
    if (!cocok) {
      // Hanya yang benar-benar terlihat seperti baris ONU yang dilaporkan.
      // Spanduk login, prompt, header, dan garis pemisah memang bukan data.
      if (POLA_INDEKS.test(garis)) takTerurai.push(garis);
      continue;
    }

    const [, indeks, adminState, omccState, phaseState, keterangan] = cocok;
    const [ponPort, onu] = indeks.split(":");
    baris.push({
      indeks,
      ponPort,
      onuId: Number(onu),
      adminState,
      omccState,
      phaseState,
      keterangan: (keterangan ?? "").trim(),
      sehat: phaseState === "working",
    });
    ringkas[phaseState] = (ringkas[phaseState] ?? 0) + 1;
  }

  return { baris, ringkas, takTerurai };
}
