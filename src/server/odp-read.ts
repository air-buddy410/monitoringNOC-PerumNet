// Pembacaan ODP untuk layar — penyaringan, pengurutan, dan halaman dikerjakan
// DATABASE, bukan browser.
//
// Bentuknya sengaja meniru `pppoe-read.ts`, yang sudah terbukti: satu layar
// tidak perlu punya rasa sendiri-sendiri.
//
// Bedanya dengan PPPoE: di sini bebannya BUKAN masalah utama. Kuerinya 6,6 ms
// dan payloadnya 148 kB untuk 580 ODP — tidak menyakiti server. Yang bermasalah
// adalah tidak ada cara MENEMUKAN apa pun: 580 baris akordion tanpa kotak cari.
//
// Pencariannya ditaruh di server sejak awal, bukan di browser, karena
// penyaringan di browser hanya menyaring yang TERKIRIM. Begitu paginasi masuk,
// hasil pencarian jadi tidak lengkap tanpa ada yang tahu — persis kebohongan
// halus yang sudah dicabut dari layar PPPoE.

import { and, asc, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { odpPorts, odps } from "@/db/schema";

export const UKURAN_HALAMAN = [20, 50, 100] as const;
export type UkuranHalaman = (typeof UKURAN_HALAMAN)[number];

/**
 * Batas untuk mode tanpa halaman (kompatibilitas layar lama).
 *
 * Layar `/ftth` hari ini memanggil endpoint ini tanpa satu pun parameter dan
 * menampilkan semuanya. Memaksakan paginasi sebagai bawaan akan membuatnya
 * diam-diam hanya memperlihatkan 20 dari 580 — jadi mode lama dipertahankan
 * sampai layarnya menyusul, dan ia MELAPOR lewat `terpotong` kalau sampai
 * memotong.
 */
export const BATAS_TANPA_HALAMAN = 2000;

export type KolomUrut = "code" | "name" | "capacity" | "usedPorts";
export const KOLOM_URUT: KolomUrut[] = ["code", "name", "capacity", "usedPorts"];

export interface KueriOdp {
  q?: string | null;
  siteId?: string | null;
  oltId?: string | null;
  sort?: KolomUrut;
  dir?: "asc" | "desc";
  page?: number | null;
  pageSize?: number | null;
}

export function ukuranSah(n: unknown): n is UkuranHalaman {
  return (UKURAN_HALAMAN as readonly number[]).includes(n as number);
}

export function kolomSah(s: unknown): s is KolomUrut {
  return KOLOM_URUT.includes(s as KolomUrut);
}

/**
 * `usedPorts` dan `brokenPorts` DITURUNKAN dari tabel port, bukan disimpan
 * sebagai kolom — supaya tidak pernah ada dua angka yang berbeda tentang hal
 * yang sama. Alasan yang sama sudah dipegang `odps.capacity`.
 */
const TERPAKAI = sql<number>`count(${odpPorts.id}) filter (where ${odpPorts.status} = 'terpakai')::int`;
const RUSAK = sql<number>`count(${odpPorts.id}) filter (where ${odpPorts.status} = 'rusak')::int`;

function urut(sort: KolomUrut) {
  if (sort === "name") return odps.name;
  if (sort === "capacity") return odps.capacity;
  if (sort === "usedPorts") return TERPAKAI;
  return odps.code;
}

/**
 * Kunci pengurutan, SELALU ditutup `code` sebagai pemecah seri.
 *
 * Tanpa itu, dua halaman berturut-turut bisa memuat baris yang sama dan
 * melewatkan yang lain: `ORDER BY capacity` di atas 580 ODP yang mayoritas
 * berkapasitas sama tidak menentukan urutan apa pun, dan PostgreSQL bebas
 * mengembalikannya berbeda antar-permintaan.
 *
 * Dipisah jadi fungsi sendiri karena kegagalannya NONDETERMINISTIK — sebuah
 * tes yang menjalankan kueri asli bisa lolos seratus kali lalu gagal di
 * produksi. Yang bisa dijaga tes adalah bentuknya, dan itu yang dijaga.
 */
export function kunciUrut(sort: KolomUrut, dir: "asc" | "desc") {
  const arah = dir === "desc" ? desc : asc;
  return [arah(urut(sort)), asc(odps.code)];
}

export async function cariOdp(kueri: KueriOdp) {
  const q = kueri.q?.trim();
  const syarat = [];
  if (q) {
    const pola = `%${q}%`;
    // Kode DAN nama sekaligus: orang di lapangan menyebut ODP dengan
    // dua-duanya, dan memilih dulu kolomnya hanya menambah satu langkah
    // sebelum menemukan apa pun.
    syarat.push(or(ilike(odps.code, pola), ilike(odps.name, pola)));
  }
  if (kueri.siteId) syarat.push(eq(odps.siteId, kueri.siteId));
  if (kueri.oltId) syarat.push(eq(odps.oltId, kueri.oltId));
  const where = syarat.length > 0 ? and(...syarat) : undefined;

  // Dihitung TANPA join ke port: `count(*)` di atas join yang menggandakan
  // baris akan menghitung port, bukan ODP — 8.656 alih-alih 580.
  const [{ total }] = await db
    .select({ total: count() })
    .from(odps)
    .where(where);

  const sort = kolomSah(kueri.sort) ? kueri.sort : "code";

  const berhalaman = kueri.page != null || kueri.pageSize != null;
  const pageSize = ukuranSah(kueri.pageSize) ? kueri.pageSize : 20;
  const halamanTerakhir = Math.max(1, Math.ceil(total / pageSize));
  // Halaman di luar jangkauan dijepit, bukan ditolak — ODP bisa bertambah
  // atau terhapus di antara dua permintaan.
  const page = berhalaman
    ? Math.min(Math.max(1, Math.trunc(kueri.page ?? 1)), halamanTerakhir)
    : 1;

  const rows = await db
    .select({
      id: odps.id,
      code: odps.code,
      name: odps.name,
      siteId: odps.siteId,
      oltId: odps.oltId,
      latitude: odps.latitude,
      longitude: odps.longitude,
      capacity: odps.capacity,
      usedPorts: TERPAKAI,
      brokenPorts: RUSAK,
    })
    .from(odps)
    .leftJoin(odpPorts, eq(odpPorts.odpId, odps.id))
    .where(where)
    .groupBy(odps.id)
    .orderBy(...kunciUrut(sort, kueri.dir === "desc" ? "desc" : "asc"))
    .limit(berhalaman ? pageSize : BATAS_TANPA_HALAMAN)
    .offset(berhalaman ? (page - 1) * pageSize : 0);

  return {
    rows,
    total,
    page: berhalaman ? page : 1,
    pageSize: berhalaman ? pageSize : Math.min(total, BATAS_TANPA_HALAMAN),
    halamanTerakhir: berhalaman ? halamanTerakhir : 1,
    berhalaman,
    /** Benar kalau mode lama memotong hasil diam-diam. */
    terpotong: !berhalaman && total > BATAS_TANPA_HALAMAN,
  };
}
