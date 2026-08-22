// Penguraia sheet "Alokasi Core 144" jadi baris core yang bisa dimuat.
//
// Sheetnya menomori tiap serat DUA KALI: `FO ID` berurut 1–144 se-kabel, dan
// "TUBE 5 - CORE 3" di dalam tabungnya. Keduanya dipertahankan, karena catatan
// lapangan memang memakai dua-duanya — lihat `fiber_cores.coreInTube`.
//
// **FO ID yang dipercaya, bukan labelnya.** Pada berkas 14 Agustus 2026 label
// TUBE/CORE keliru di delapan baris, dan kekeliruannya sistematis: tiap tabung
// 5 sampai 12, baris CORE 4-nya tertulis "CORE <nomor tabung>" — khas
// kesalahan tarik-isi spreadsheet. FO ID-nya sendiri utuh: 1–144, tanpa
// duplikat, tanpa lompatan.
//
// Kekeliruannya DILAPORKAN, tidak diperbaiki diam-diam. Pengimpor yang
// membetulkan sendiri catatan lapangan membuat sheet dan database perlahan
// berbeda tanpa ada yang tahu — dan yang di lapangan tetap membaca sheetnya.

/** Urutan warna TIA-598, sama dengan `WARNA_CORE` di skema. */
export const WARNA_TABUNG = [
  "biru",
  "jingga",
  "hijau",
  "coklat",
  "abu-abu",
  "putih",
  "merah",
  "hitam",
  "kuning",
  "ungu",
  "merah muda",
  "tosca",
] as const;

/** Berapa serat per tabung pada kabel 144 core: 12 tabung × 12 serat. */
export const SERAT_PER_TABUNG = 12;

export interface BarisAlokasi {
  /** FO ID: nomor serat se-kabel, 1-basis. Ini kunci yang sah. */
  foId: number;
  /** Tabung, diturunkan dari `foId`. */
  tubeNumber: number;
  /** Posisi di dalam tabung, diturunkan dari `foId`. */
  coreInTube: number;
  /** Warna serat, diturunkan dari posisinya di dalam tabung. */
  color: string;
  dari: string;
  nextHop: string;
  usage: string;
  service: string;
  /** Label apa adanya dari sheet — disimpan supaya bisa dicocokkan di lapangan. */
  label: string;
}

export interface MasalahAlokasi {
  foId: number;
  jenis: "label-keliru" | "fo-id-ganda" | "fo-id-hilang" | "baris-tak-terbaca";
  pesan: string;
}

export interface HasilAlokasi {
  baris: BarisAlokasi[];
  masalah: MasalahAlokasi[];
}

const POLA_LABEL = /^TUBE\s+(\d+)\s*-\s*CORE\s+(\d+)$/i;

/** Belah satu baris CSV; menghormati tanda kutip ganda. */
function belahCsv(baris: string): string[] {
  const keluar: string[] = [];
  let kini = "";
  let dalamKutip = false;
  for (let i = 0; i < baris.length; i += 1) {
    const c = baris[i];
    if (dalamKutip) {
      if (c === '"' && baris[i + 1] === '"') { kini += '"'; i += 1; }
      else if (c === '"') dalamKutip = false;
      else kini += c;
    } else if (c === '"') dalamKutip = true;
    else if (c === ",") { keluar.push(kini); kini = ""; }
    else kini += c;
  }
  keluar.push(kini);
  return keluar.map((s) => s.trim());
}

/**
 * Urai CSV alokasi core.
 *
 * Kolom yang diharapkan: `fo_id,label,warna_tube,dari,next_hop,usage,service`.
 * Header dibaca dari baris pertama, jadi urutan kolomnya boleh berubah.
 *
 * `jumlahCore` dipakai untuk memeriksa kelengkapan — 144 untuk kabel ini.
 * Serat yang hilang dan yang ganda sama-sama dilaporkan: sheet yang kehilangan
 * satu baris menghasilkan kabel yang terlihat utuh dengan satu serat yang
 * tidak pernah ada, dan itu baru ketahuan saat seseorang mencarinya di
 * lapangan.
 */
export function uraiAlokasiCore(csv: string, jumlahCore: number): HasilAlokasi {
  const baris: BarisAlokasi[] = [];
  const masalah: MasalahAlokasi[] = [];

  const semua = csv.split(/\r?\n/).filter((b) => b.trim().length > 0);
  if (semua.length === 0) return { baris, masalah };

  const kepala = belahCsv(semua[0]).map((h) => h.toLowerCase());
  const idx = (nama: string) => kepala.indexOf(nama);
  const kolom = {
    foId: idx("fo_id"),
    label: idx("label"),
    dari: idx("dari"),
    nextHop: idx("next_hop"),
    usage: idx("usage"),
    service: idx("service"),
  };

  const terlihat = new Set<number>();
  for (let i = 1; i < semua.length; i += 1) {
    const sel = belahCsv(semua[i]);
    const foId = Number(sel[kolom.foId]);
    if (!Number.isInteger(foId) || foId < 1) {
      masalah.push({
        foId: 0,
        jenis: "baris-tak-terbaca",
        pesan: `Baris ${i + 1}: FO ID "${sel[kolom.foId] ?? ""}" bukan bilangan bulat positif.`,
      });
      continue;
    }
    if (terlihat.has(foId)) {
      masalah.push({
        foId,
        jenis: "fo-id-ganda",
        pesan: `FO ID ${foId} muncul lebih dari sekali.`,
      });
      continue;
    }
    terlihat.add(foId);

    const tubeNumber = Math.floor((foId - 1) / SERAT_PER_TABUNG) + 1;
    const coreInTube = ((foId - 1) % SERAT_PER_TABUNG) + 1;

    const label = kolom.label >= 0 ? (sel[kolom.label] ?? "") : "";
    const cocok = POLA_LABEL.exec(label);
    if (cocok) {
      const t = Number(cocok[1]);
      const c = Number(cocok[2]);
      if (t !== tubeNumber || c !== coreInTube) {
        masalah.push({
          foId,
          jenis: "label-keliru",
          pesan: `FO ID ${foId}: label sheet "TUBE ${t} - CORE ${c}" tidak cocok dengan posisi dari FO ID, yaitu "TUBE ${tubeNumber} - CORE ${coreInTube}".`,
        });
      }
    }

    baris.push({
      foId,
      tubeNumber,
      coreInTube,
      color: WARNA_TABUNG[(coreInTube - 1) % WARNA_TABUNG.length],
      dari: kolom.dari >= 0 ? (sel[kolom.dari] ?? "") : "",
      nextHop: kolom.nextHop >= 0 ? (sel[kolom.nextHop] ?? "") : "",
      usage: kolom.usage >= 0 ? (sel[kolom.usage] ?? "") : "",
      service: kolom.service >= 0 ? (sel[kolom.service] ?? "") : "",
      label,
    });
  }

  for (let fo = 1; fo <= jumlahCore; fo += 1) {
    if (!terlihat.has(fo)) {
      masalah.push({ foId: fo, jenis: "fo-id-hilang", pesan: `FO ID ${fo} tidak ada di sheet.` });
    }
  }

  baris.sort((a, b) => a.foId - b.foId);
  return { baris, masalah };
}

/**
 * Catatan per core, dirangkai dari kolom yang terisi.
 *
 * Kolom kosong TIDAK dikarang jadi kalimat: core tanpa alokasi memang belum
 * dialokasikan, dan menuliskan "belum dipakai" mengubah ketiadaan catatan
 * jadi pernyataan yang tidak pernah dibuat siapa pun.
 */
export function catatanCore(b: BarisAlokasi): string | null {
  const bagian = [
    b.dari && `Dari: ${b.dari}`,
    b.nextHop && `Next hop: ${b.nextHop}`,
    b.usage && `Pemakaian: ${b.usage}`,
    b.service && `Layanan: ${b.service}`,
  ].filter(Boolean);
  return bagian.length > 0 ? bagian.join(" · ") : null;
}
