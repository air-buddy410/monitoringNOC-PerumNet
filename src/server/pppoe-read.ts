// Pembacaan sesi PPPoE untuk layar — penyaringan, pengurutan, dan halaman
// dikerjakan DATABASE, bukan browser.
//
// Sebelum ini endpoint-nya mengirim seluruh sesi sekaligus (batas 2.000) dan
// layar menyaring sendiri. Di produksi itu berarti ~1.600 baris JSON tiap
// kali halaman dibuka atau di-refresh, hanya untuk menampilkan dua puluh.
// Penyaringan di browser juga berbohong halus: ia hanya menyaring yang
// TERKIRIM, jadi begitu jumlah sesi melewati batas, hasil pencarian jadi
// tidak lengkap tanpa ada yang tahu.

import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { pppoeSessions } from "@/db/schema";

export const UKURAN_HALAMAN = [20, 50, 100] as const;
export type UkuranHalaman = (typeof UKURAN_HALAMAN)[number];

/** Batas untuk mode tanpa halaman (kompatibilitas layar lama). */
export const BATAS_TANPA_HALAMAN = 2000;

export type KolomUrut = "username" | "address" | "uptime" | "seenAt" | "router";
export const KOLOM_URUT: KolomUrut[] = [
  "username",
  "address",
  "uptime",
  "seenAt",
  "router",
];

export interface KueriSesi {
  q?: string | null;
  router?: string | null;
  sort?: KolomUrut;
  dir?: "asc" | "desc";
  page?: number | null;
  pageSize?: number | null;
}

function kolom(sort: KolomUrut) {
  if (sort === "address") return pppoeSessions.address;
  if (sort === "uptime") return pppoeSessions.uptimeSec;
  if (sort === "seenAt") return pppoeSessions.seenAt;
  if (sort === "router") return pppoeSessions.routerName;
  return pppoeSessions.username;
}

export function ukuranSah(n: unknown): n is UkuranHalaman {
  return (UKURAN_HALAMAN as readonly number[]).includes(n as number);
}

/**
 * Daftar router yang benar-benar muncul di sesi — pengisi dropdown penyaring.
 *
 * Diturunkan dari sesi, bukan dari daftar perangkat: penyaring yang menawarkan
 * router tanpa satu pun sesi hanya menghasilkan tabel kosong dan kebingungan.
 */
export async function daftarRouter() {
  const rows = await db
    .selectDistinct({ routerName: pppoeSessions.routerName })
    .from(pppoeSessions)
    .orderBy(asc(pppoeSessions.routerName));
  return rows.map((r) => r.routerName).filter((n): n is string => Boolean(n));
}

export async function cariSesi(kueri: KueriSesi) {
  const q = kueri.q?.trim();
  const syarat = [];
  if (q) {
    const pola = `%${q}%`;
    // Tiga kolom sekaligus: operator mencari "yang mana pun cocok", bukan
    // memilih dulu kolomnya.
    syarat.push(
      or(
        ilike(pppoeSessions.username, pola),
        ilike(pppoeSessions.address, pola),
        ilike(pppoeSessions.callerId, pola),
      ),
    );
  }
  if (kueri.router) syarat.push(eq(pppoeSessions.routerName, kueri.router));
  const where = syarat.length > 0 ? and(...syarat) : undefined;

  const sort = kueri.sort ?? "username";
  const arah = kueri.dir === "desc" ? desc : asc;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(pppoeSessions)
    .where(where);

  const berhalaman = kueri.page != null || kueri.pageSize != null;
  const pageSize = ukuranSah(kueri.pageSize) ? kueri.pageSize : 20;
  const halamanTerakhir = Math.max(1, Math.ceil(total / pageSize));
  // Halaman di luar jangkauan dijepit, bukan ditolak: jumlah sesi berubah
  // tiap dua menit, dan halaman 9 yang sah saat diklik bisa sudah tidak ada
  // saat permintaannya tiba.
  const page = berhalaman
    ? Math.min(Math.max(1, Math.trunc(kueri.page ?? 1)), halamanTerakhir)
    : 1;

  const rows = await db
    .select()
    .from(pppoeSessions)
    .where(where)
    .orderBy(arah(kolom(sort)), asc(pppoeSessions.username))
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
