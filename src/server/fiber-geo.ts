// Garis jalur fiber untuk peta (Fase 15).
//
// Tidak ada tabel baru dan tidak ada kolom geometri. Letak sebuah kabel
// DITURUNKAN dari tempat core-nya menempel: ujung yang diterminasi ke port
// OTB/ODP memakai koordinat perangkatnya, ujung yang disambung di closure
// memakai koordinat closure-nya.
//
// ATURAN YANG MENENTUKAN SELURUH BENTUK BERKAS INI: kabel yang kedua ujungnya
// tidak diketahui TIDAK DIGAMBAR. Ia masuk daftar `tanpaGeometri` beserta
// alasannya (PRD §3 aturan "geometry yang hilang tidak boleh diganti garis
// perkiraan").
//
// Garis tebakan di peta jaringan bukan ketidaknyamanan kecil. Ia dipakai orang
// untuk memutuskan ke mana berangkat saat kabel putus — dan garis yang salah
// mengirim teknisi ke tempat yang salah dengan keyakinan penuh. Peta yang
// jujur mengaku tidak tahu jauh lebih berguna daripada peta yang lengkap.

import { and, asc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  fiberCableSegments,
  fiberClosures,
  fiberCoreSplices,
  fiberCoreTerminations,
  fiberCores,
  networkSites,
  odpPorts,
  odps,
  otb,
  otbPorts,
} from "@/db/schema";

export type JenisSimpul = "OTB" | "CLOSURE" | "MS" | "ODP";

export interface Simpul {
  jenis: JenisSimpul;
  id: string;
  code: string;
  name: string | null;
  latitude: number;
  longitude: number;
}

export interface GarisKabel {
  id: string;
  code: string;
  category: string;
  lengthM: number | null;
  /** Dua ujung, masing-masing [lon, lat] — urutan GeoJSON. */
  koordinat: [[number, number], [number, number]];
  dari: { jenis: JenisSimpul; code: string };
  ke: { jenis: JenisSimpul; code: string };
  coreTerpakai: number;
  coreTotal: number;
}

export interface KabelTanpaGeometri {
  id: string;
  code: string;
  category: string;
  alasan: string;
  /**
   * Ujung kabel yang TERCATAT (bukan diturunkan), kalau ada.
   *
   * Sengaja TIDAK dipakai menggambar garis. Jalur nyata mengikuti jalan
   * sepanjang kilometer; garis lurus antara dua POP akan terbaca sebagai
   * rute dan mengirim teknisi ke tempat yang salah — persis yang dilarang
   * aturan di kepala berkas ini. Yang ditambahkannya cuma penjelasan: bukan
   * "tidak tahu sama sekali", melainkan "ujungnya tahu, jalurnya belum".
   */
  ujungTercatat?: { a: string | null; b: string | null };
}

interface Jangkar {
  jenis: JenisSimpul;
  id: string;
  code: string;
  name: string | null;
  latitude: number | null;
  longitude: number | null;
}

function berkoordinat(j: Jangkar): j is Jangkar & { latitude: number; longitude: number } {
  return typeof j.latitude === "number" && typeof j.longitude === "number";
}

/**
 * Di mana sebuah ujung core menempel.
 *
 * Satu ujung bisa menempel di port (terminasi) ATAU di closure (silangan),
 * tidak pernah keduanya — itu dijaga `closure-store.ts`. Kalau ternyata
 * keduanya ada, trace melaporkannya AMBIGU dan peta ikut menolak menggambar.
 */
async function jangkarPerUjung(segmentId: string) {
  const terminasi = await db
    .select({
      coreEnd: fiberCoreTerminations.coreEnd,
      otbId: otb.id,
      otbCode: otb.code,
      otbName: otb.name,
      otbLat: otb.latitude,
      otbLon: otb.longitude,
      siteLat: networkSites.latitude,
      siteLon: networkSites.longitude,
      odpId: odps.id,
      odpCode: odps.code,
      odpName: odps.name,
      odpRole: odps.role,
      odpLat: odps.latitude,
      odpLon: odps.longitude,
    })
    .from(fiberCoreTerminations)
    .innerJoin(fiberCores, eq(fiberCores.id, fiberCoreTerminations.coreId))
    .leftJoin(otbPorts, eq(otbPorts.id, fiberCoreTerminations.otbPortId))
    .leftJoin(otb, eq(otb.id, otbPorts.otbId))
    .leftJoin(networkSites, eq(networkSites.id, otb.siteId))
    .leftJoin(odpPorts, eq(odpPorts.id, fiberCoreTerminations.odpPortId))
    .leftJoin(odps, eq(odps.id, odpPorts.odpId))
    .where(
      and(
        eq(fiberCores.segmentId, segmentId),
        isNull(fiberCoreTerminations.deactivatedAt),
      ),
    );

  const silangan = await db
    .select({
      inputCoreEnd: fiberCoreSplices.inputCoreEnd,
      outputCoreEnd: fiberCoreSplices.outputCoreEnd,
      inputSegment: fiberCores.segmentId,
      closureId: fiberClosures.id,
      closureCode: fiberClosures.code,
      closureName: fiberClosures.name,
      closureLat: fiberClosures.latitude,
      closureLon: fiberClosures.longitude,
      outputCoreId: fiberCoreSplices.outputCoreId,
      inputCoreId: fiberCoreSplices.inputCoreId,
    })
    .from(fiberCoreSplices)
    .innerJoin(fiberClosures, eq(fiberClosures.id, fiberCoreSplices.closureId))
    .innerJoin(fiberCores, eq(fiberCores.id, fiberCoreSplices.inputCoreId))
    .where(isNull(fiberCoreSplices.deactivatedAt));

  const coreSegmen = await db
    .select({ id: fiberCores.id })
    .from(fiberCores)
    .where(eq(fiberCores.segmentId, segmentId));
  const milikKita = new Set(coreSegmen.map((c) => c.id));

  const per: Record<"A" | "B", Map<string, Jangkar>> = { A: new Map(), B: new Map() };

  for (const t of terminasi) {
    const ujung = t.coreEnd as "A" | "B";
    if (t.otbId) {
      // OTB di dalam situs memakai koordinat situsnya; OTB tiang punya sendiri.
      per[ujung].set(`OTB:${t.otbId}`, {
        jenis: "OTB", id: t.otbId, code: t.otbCode!, name: t.otbName,
        latitude: t.otbLat ?? t.siteLat, longitude: t.otbLon ?? t.siteLon,
      });
    } else if (t.odpId) {
      per[ujung].set(`ODP:${t.odpId}`, {
        jenis: t.odpRole === "MS" ? "MS" : "ODP",
        id: t.odpId, code: t.odpCode!, name: t.odpName,
        latitude: t.odpLat, longitude: t.odpLon,
      });
    }
  }

  for (const s of silangan) {
    for (const [coreId, ujung] of [
      [s.inputCoreId, s.inputCoreEnd],
      [s.outputCoreId, s.outputCoreEnd],
    ] as const) {
      if (!milikKita.has(coreId)) continue;
      per[ujung as "A" | "B"].set(`CL:${s.closureId}`, {
        jenis: "CLOSURE", id: s.closureId, code: s.closureCode,
        name: s.closureName, latitude: s.closureLat, longitude: s.closureLon,
      });
    }
  }

  return per;
}

export async function petaFiber() {
  // Dua alias ke tabel yang sama — satu kabel menunjuk DUA situs sekaligus,
  // jadi satu join tidak cukup.
  const situsA = alias(networkSites, "situs_a");
  const situsB = alias(networkSites, "situs_b");

  const kabel = await db
    .select({
      id: fiberCableSegments.id,
      code: fiberCableSegments.code,
      category: fiberCableSegments.category,
      lengthM: fiberCableSegments.lengthM,
      coreCount: fiberCableSegments.coreCount,
      status: fiberCableSegments.status,
      siteACode: situsA.code,
      siteBCode: situsB.code,
    })
    .from(fiberCableSegments)
    .leftJoin(situsA, eq(situsA.id, fiberCableSegments.siteAId))
    .leftJoin(situsB, eq(situsB.id, fiberCableSegments.siteBId))
    .where(eq(fiberCableSegments.status, "aktif"))
    .orderBy(asc(fiberCableSegments.code));

  const garis: GarisKabel[] = [];
  const tanpaGeometri: KabelTanpaGeometri[] = [];
  const simpul = new Map<string, Simpul>();

  for (const k of kabel) {
    const per = await jangkarPerUjung(k.id);
    const a = [...per.A.values()];
    const b = [...per.B.values()];

    const punyaUjung = k.siteACode !== null || k.siteBCode !== null;
    const catat = (alasan: string) =>
      tanpaGeometri.push({
        id: k.id,
        code: k.code,
        category: k.category,
        alasan: punyaUjung
          ? `${alasan} Ujungnya tercatat: ${k.siteACode ?? "?"} → ${k.siteBCode ?? "?"}; jalurnya belum tersurvei, jadi tidak digambar.`
          : alasan,
        ...(punyaUjung
          ? { ujungTercatat: { a: k.siteACode, b: k.siteBCode } }
          : {}),
      });

    if (a.length === 0 || b.length === 0) {
      catat(
        a.length === 0 && b.length === 0
          ? "Belum ada core yang diterminasi atau disambung — kedua ujungnya belum diketahui."
          : `Hanya satu ujung yang diketahui (${a.length === 0 ? "B" : "A"}); ujung lain belum tersambung ke mana pun.`,
      );
      continue;
    }
    // Lebih dari satu jangkar berarti core-core dalam satu kabel berakhir di
    // tempat berbeda. Itu bisa saja benar di lapangan, tapi satu garis lurus
    // tidak bisa mewakilinya — dan menggambar salah satunya berarti memilih
    // diam-diam.
    if (a.length > 1 || b.length > 1) {
      catat(
        `Ujung ${a.length > 1 ? "A" : "B"} menempel di ${Math.max(a.length, b.length)} tempat berbeda. Satu garis tidak bisa mewakilinya.`,
      );
      continue;
    }

    const [ja] = a;
    const [jb] = b;
    if (!berkoordinat(ja) || !berkoordinat(jb)) {
      const yangKosong = !berkoordinat(ja) ? ja : jb;
      catat(`${yangKosong.jenis} ${yangKosong.code} belum punya koordinat.`);
      continue;
    }

    const terpasang = await db
      .select({ id: fiberCoreTerminations.id })
      .from(fiberCoreTerminations)
      .innerJoin(fiberCores, eq(fiberCores.id, fiberCoreTerminations.coreId))
      .where(
        and(
          eq(fiberCores.segmentId, k.id),
          isNull(fiberCoreTerminations.deactivatedAt),
        ),
      );

    for (const j of [ja, jb]) {
      simpul.set(`${j.jenis}:${j.id}`, {
        jenis: j.jenis, id: j.id, code: j.code, name: j.name,
        latitude: j.latitude, longitude: j.longitude,
      });
    }

    garis.push({
      id: k.id,
      code: k.code,
      category: k.category,
      lengthM: k.lengthM,
      koordinat: [
        [ja.longitude, ja.latitude],
        [jb.longitude, jb.latitude],
      ],
      dari: { jenis: ja.jenis, code: ja.code },
      ke: { jenis: jb.jenis, code: jb.code },
      coreTerpakai: terpasang.length,
      coreTotal: k.coreCount,
    });
  }

  return {
    simpul: [...simpul.values()].sort((x, y) => x.code.localeCompare(y.code)),
    garis,
    tanpaGeometri,
    ringkas: {
      kabelAktif: kabel.length,
      tergambar: garis.length,
      tanpaGeometri: tanpaGeometri.length,
    },
  };
}
