// Penguraian daftar akun, dipisah dari skripnya supaya bisa diuji.
//
// Skripnya sendiri memuat env dan menyentuh database saat diimpor, jadi ia
// tidak bisa diimpor dari tes. Pola yang sama dengan `migrate-lib.mjs` dan
// `librenms-asset-import-lib.mjs` di folder ini.

import path from "node:path";

export const PERAN_SAH = new Set(["admin", "noc", "engineer", "manajemen"]);

export interface BarisAkun {
  email: string;
  nama: string;
  peran: "admin" | "noc" | "engineer" | "manajemen";
  /** Akun yang tetap boleh masuk dengan password lokal saat mailserver mati. */
  darurat: boolean;
}

export function uraikanDaftar(isi: string): BarisAkun[] {
  const hasil: BarisAkun[] = [];
  isi.split("\n").forEach((baris, i) => {
    const bersih = baris.trim();
    if (!bersih || bersih.startsWith("#")) return;
    // Dipisah TAB, bukan spasi: nama orang memuat spasi, dan memisah dengan
    // spasi berarti "I Made Darma Yasa" jadi empat kolom.
    const kolom = bersih.split("\t").map((k) => k.trim());
    if (kolom.length < 3) {
      throw new Error(
        `Baris ${i + 1}: butuh 3 kolom (email, nama, peran) dipisah TAB.`,
      );
    }
    const [email, nama, peran, tanda] = kolom;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(`Baris ${i + 1}: "${email}" bukan alamat email.`);
    }
    if (!nama) throw new Error(`Baris ${i + 1}: nama kosong.`);
    if (!PERAN_SAH.has(peran)) {
      throw new Error(`Baris ${i + 1}: peran "${peran}" tidak dikenal.`);
    }
    hasil.push({
      email: email.toLowerCase(),
      nama,
      peran: peran as BarisAkun["peran"],
      darurat: (tanda ?? "").toLowerCase() === "darurat",
    });
  });
  return hasil;
}

/**
 * Repo ini PUBLIK. Daftar nama & email pegawai tidak boleh tinggal di
 * dalamnya, jadi berkas daftar yang berada di dalam repo ditolak — bukan
 * diperingatkan. Peringatan gampang dilewati; penolakan tidak.
 */
export function diDalamRepo(jalurBerkas: string, akarRepo: string): boolean {
  const berkas = path.resolve(jalurBerkas);
  const akar = path.resolve(akarRepo);
  return berkas === akar || berkas.startsWith(akar + path.sep);
}
