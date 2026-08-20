// Deteksi gangguan massal — bertingkat, dan menjawab "apa yang didatangi".
//
// Alasannya sudah dibayar CRM dan disalin apa adanya: 39 padam tersebar di 39
// ODP = 39 modem dicabut, tidak ada yang perlu didatangi. 39 padam dengan 20
// di antaranya pada SATU ODP = jalur putus, satu teknisi menyelesaikan 20
// keluhan. Angka totalnya sama, tindakannya beda — dan angka total sendirian
// tidak pernah bisa membedakannya.
//
// Sumber "seharusnya online" adalah `odp_customers` yang berstatus ACTIVE.
// Sumber "sedang online" adalah `pppoe_sessions`, yang ditulis ulang penuh
// tiap 60 detik oleh `pppoe.poll`. Selisihnya = padam.
//
// **Yang berstatus ISOLATED/INACTIVE tidak pernah dihitung.** Mereka memang
// tidak online, selamanya. Tanpa aturan itu, 85 pelanggan terisolir akan
// menyalakan gerombol permanen yang tidak pernah bisa dipadamkan siapa pun —
// dan orang berhenti membaca alarmnya dalam seminggu.

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  networkSites,
  odpCustomers,
  odps,
  oltDevices,
  pppoeSessions,
} from "@/db/schema";

/**
 * Ambang gerombol: dua pelanggan.
 *
 * Angka ini SAMA dengan yang dipakai CRM, dan itu disengaja. Dua aplikasi
 * yang menyebut angka berbeda untuk gangguan yang sama membuat orang berhenti
 * mempercayai keduanya.
 */
export const AMBANG_PADAM = 2;

/**
 * Bagian minimum yang harus padam sebelum sebuah OLT atau SITUS disalahkan.
 *
 * Untuk ODP, hitungan saja cukup: dua tetangga padam bersamaan pada satu kotak
 * sudah mencurigakan. Untuk OLT dan situs tidak — tanpa pecahan ini, dua
 * pelanggan padam di ujung berbeda kabupaten akan dilaporkan sebagai "situs
 * padam", dan itu memanggil orang ke tempat yang tidak rusak.
 */
export const AMBANG_BAGIAN = 0.5;

export interface PelangganDiharapkan {
  username: string;
  odpId: string;
  odpCode: string;
  oltId: string | null;
  oltName: string | null;
  siteId: string | null;
  siteName: string | null;
}

export type TingkatPadam = "SITUS" | "OLT" | "ODP";

export interface Gerombol {
  level: TingkatPadam;
  id: string;
  name: string;
  /** Berapa yang seharusnya online tapi tidak ada di sesi. */
  padam: number;
  /** Berapa pelanggan AKTIF yang bernaung di bawahnya. */
  total: number;
  usernames: string[];
}

interface Ember {
  id: string;
  name: string;
  padam: string[];
  total: number;
  /** ODP mana saja yang menyumbang padam — inti aturan sebaran di bawah. */
  odpPadam: Set<string>;
}

function kumpulkan(
  diharapkan: PelangganDiharapkan[],
  padam: Set<string>,
  kunci: (p: PelangganDiharapkan) => { id: string; name: string } | null,
): Ember[] {
  const peta = new Map<string, Ember>();
  for (const p of diharapkan) {
    const k = kunci(p);
    if (!k) continue;
    let e = peta.get(k.id);
    if (!e) {
      e = { id: k.id, name: k.name, padam: [], total: 0, odpPadam: new Set() };
      peta.set(k.id, e);
    }
    e.total += 1;
    if (padam.has(p.username)) {
      e.padam.push(p.username);
      e.odpPadam.add(p.odpId);
    }
  }
  return [...peta.values()];
}

/**
 * Sebuah OLT atau SITUS hanya disalahkan bila padamnya TERSEBAR di lebih dari
 * satu ODP.
 *
 * Tanpa aturan ini, satu kabel drop yang memutus dua tetangga pada ODP yang
 * sama akan dilaporkan sebagai "OLT padam" di jaringan kecil — dan orang
 * dikirim memeriksa perangkat yang sehat, sementara kabel yang putus tidak
 * disebut sama sekali. Salahkan tingkat TERDALAM yang masih menjelaskan
 * seluruh padamnya.
 */
function indukLayakDisalahkan(e: Ember, ambang: number, bagian: number): boolean {
  return (
    e.padam.length >= ambang &&
    e.padam.length / e.total >= bagian &&
    e.odpPadam.size >= 2
  );
}

/**
 * Mengelompokkan pelanggan padam jadi gerombol yang bisa ditindaklanjuti.
 *
 * Murni: tidak menyentuh database, tidak memakai jam. Seluruh aturannya
 * teruji di `tests/outage.test.ts`.
 *
 * Tingkat yang lebih tinggi MENELAN yang lebih rendah. Kalau satu situs
 * padam, 40 alarm ODP di bawahnya bukan 40 informasi — itu satu informasi
 * yang diulang 40 kali, dan mengubur satu-satunya baris yang berguna.
 */
export function kelompokkanPadam(
  diharapkan: PelangganDiharapkan[],
  hadir: Set<string>,
  opts?: { ambang?: number; ambangBagian?: number },
): Gerombol[] {
  const ambang = opts?.ambang ?? AMBANG_PADAM;
  const bagian = opts?.ambangBagian ?? AMBANG_BAGIAN;

  const padam = new Set(
    diharapkan.map((p) => p.username).filter((u) => !hadir.has(u)),
  );
  if (padam.size === 0) return [];

  const situs = kumpulkan(diharapkan, padam, (p) =>
    p.siteId ? { id: p.siteId, name: p.siteName ?? p.siteId } : null,
  ).filter((e) => indukLayakDisalahkan(e, ambang, bagian));

  const situsMenyala = new Set(situs.map((e) => e.id));

  const olt = kumpulkan(diharapkan, padam, (p) =>
    p.oltId ? { id: p.oltId, name: p.oltName ?? p.oltId } : null,
  )
    .filter((e) => indukLayakDisalahkan(e, ambang, bagian))
    // Ditelan situs: OLT yang situsnya sudah menyala bukan informasi baru.
    .filter((e) => {
      const s = diharapkan.find((p) => p.oltId === e.id)?.siteId;
      return !(s && situsMenyala.has(s));
    });

  const oltMenyala = new Set(olt.map((e) => e.id));

  const odp = kumpulkan(diharapkan, padam, (p) => ({
    id: p.odpId,
    name: p.odpCode,
  }))
    .filter((e) => e.padam.length >= ambang)
    .filter((e) => {
      const anggota = diharapkan.find((p) => p.odpId === e.id);
      if (anggota?.siteId && situsMenyala.has(anggota.siteId)) return false;
      if (anggota?.oltId && oltMenyala.has(anggota.oltId)) return false;
      return true;
    });

  const jadikan = (e: Ember, level: TingkatPadam): Gerombol => ({
    level,
    id: e.id,
    name: e.name,
    padam: e.padam.length,
    total: e.total,
    usernames: [...e.padam].sort(),
  });

  return [
    ...situs.map((e) => jadikan(e, "SITUS")),
    ...olt.map((e) => jadikan(e, "OLT")),
    ...odp.map((e) => jadikan(e, "ODP")),
  ].sort((a, b) => b.padam - a.padam);
}

/** Pelanggan yang SEHARUSNYA online, beserta rantai ODP → OLT → situs. */
export async function muatPelangganAktif(): Promise<PelangganDiharapkan[]> {
  const rows = await db
    .select({
      username: odpCustomers.pppoeUsername,
      odpId: odps.id,
      odpCode: odps.code,
      oltId: oltDevices.id,
      oltName: oltDevices.name,
      siteId: networkSites.id,
      siteName: networkSites.name,
    })
    .from(odpCustomers)
    .innerJoin(odps, eq(odps.id, odpCustomers.odpId))
    .leftJoin(oltDevices, eq(oltDevices.id, odps.oltId))
    .leftJoin(networkSites, eq(networkSites.id, odps.siteId))
    .where(eq(odpCustomers.subscriptionStatus, "ACTIVE"));
  return rows;
}

/** Username yang sedang terlihat di sesi PPPoE terakhir. */
export async function muatSesiHadir(): Promise<Set<string>> {
  const rows = await db
    .select({ username: pppoeSessions.username })
    .from(pppoeSessions);
  return new Set(rows.map((r) => r.username.trim().toLowerCase()));
}

export interface RingkasanPadam {
  clusters: Gerombol[];
  /** Total pelanggan aktif yang tidak terlihat di sesi — termasuk yang tersebar. */
  padamTotal: number;
  /** Padam yang TIDAK menggerombol: kemungkinan besar modem dicabut sendiri. */
  padamTersebar: number;
  aktifTotal: number;
}

export async function ringkasPadam(): Promise<RingkasanPadam> {
  const [diharapkan, hadir] = await Promise.all([
    muatPelangganAktif(),
    muatSesiHadir(),
  ]);
  const clusters = kelompokkanPadam(diharapkan, hadir);
  const padamTotal = diharapkan.filter((p) => !hadir.has(p.username)).length;
  const dalamGerombol = new Set(clusters.flatMap((c) => c.usernames));
  return {
    clusters,
    padamTotal,
    padamTersebar: padamTotal - dalamGerombol.size,
    aktifTotal: diharapkan.length,
  };
}
