// Closure dan silangan core (Fase 13).
//
// Dua hal yang membedakan berkas ini dari fase sebelumnya.
//
// PERTAMA: pratinjau dan commit memakai fungsi pemeriksa yang SAMA
// (`periksaBaris`). Kalau keduanya punya jalur validasi sendiri-sendiri,
// pratinjau cepat atau lambat akan menjanjikan sesuatu yang ditolak commit —
// dan operator berhenti mempercayai pratinjaunya, yang membuat fitur itu
// mati.
//
// KEDUA: pemasangan massal bersifat semua-atau-tidak-sama-sekali. Satu baris
// bentrok membatalkan seluruh batch. Menyimpan sebagian dari matriks silangan
// menghasilkan closure yang setengah benar, dan itu lebih berbahaya daripada
// closure yang belum diisi — karena ia terlihat sudah dikerjakan.

import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  auditLogs,
  fiberCableSegments,
  fiberClosures,
  fiberCoreSplices,
  fiberCoreTerminations,
  fiberCores,
  networkSites,
} from "@/db/schema";

export type UjungCore = "A" | "B";
export type JenisClosure = "inline" | "dome" | "lain";

export const MAKS_SILANGAN_PER_BATCH = 288;

export type Hasil<T> =
  | { ok: true; data: T }
  | { ok: false; status: 400 | 404 | 409; error: string };

export interface BarisSilangan {
  inputCoreId: string;
  inputCoreEnd: UjungCore;
  outputCoreId: string;
  outputCoreEnd: UjungCore;
  estimatedLossDb?: number | null;
}

export interface VerdictBaris {
  urutan: number;
  ok: boolean;
  error?: string;
  /** Terisi kalau nomor core berubah — inilah yang bikin trace harus
   *  mengikuti nomor baru, dan yang paling sering luput dicatat manual. */
  silangNomor?: { dari: number; ke: number };
}

async function catat(
  executor: typeof db,
  action: string,
  entityType: "fiber_closure" | "fiber_splice",
  entityId: string,
  actorUserId: string | null,
  detail?: Record<string, unknown>,
) {
  await executor.insert(auditLogs).values({
    id: randomUUID(),
    actorUserId,
    actorLabel: actorUserId ? "user" : "system",
    action,
    entityType,
    entityId,
    detail,
    createdAt: new Date(),
  });
}

function kunci(coreId: string, ujung: string) {
  return `${coreId}#${ujung}`;
}

// ---------------------------------------------------------------------------
// Baca
// ---------------------------------------------------------------------------

export async function daftarClosure() {
  return db
    .select({
      id: fiberClosures.id,
      code: fiberClosures.code,
      name: fiberClosures.name,
      siteId: fiberClosures.siteId,
      siteName: networkSites.name,
      latitude: fiberClosures.latitude,
      longitude: fiberClosures.longitude,
      type: fiberClosures.type,
      status: fiberClosures.status,
      silanganAktif: sql<number>`count(${fiberCoreSplices.id}) filter (where ${fiberCoreSplices.deactivatedAt} is null)::int`,
      silanganTotal: sql<number>`count(${fiberCoreSplices.id})::int`,
    })
    .from(fiberClosures)
    .leftJoin(networkSites, eq(networkSites.id, fiberClosures.siteId))
    .leftJoin(fiberCoreSplices, eq(fiberCoreSplices.closureId, fiberClosures.id))
    .groupBy(fiberClosures.id, networkSites.name)
    .orderBy(asc(fiberClosures.code));
}

/**
 * Matriks silangan sebuah closure.
 *
 * `aktifSaja: false` mengembalikan yang sudah dilepas juga — dan itu yang
 * dicari orang saat gangguan, bukan keadaan sekarang.
 */
export async function detailClosure(closureId: string, aktifSaja = true) {
  const [closure] = await db
    .select({
      id: fiberClosures.id,
      code: fiberClosures.code,
      name: fiberClosures.name,
      siteId: fiberClosures.siteId,
      siteName: networkSites.name,
      latitude: fiberClosures.latitude,
      longitude: fiberClosures.longitude,
      type: fiberClosures.type,
      status: fiberClosures.status,
      notes: fiberClosures.notes,
      createdAt: fiberClosures.createdAt,
    })
    .from(fiberClosures)
    .leftJoin(networkSites, eq(networkSites.id, fiberClosures.siteId))
    .where(eq(fiberClosures.id, closureId))
    .limit(1);
  if (!closure) return null;

  const masuk = alias(fiberCores, "core_masuk");
  const keluar = alias(fiberCores, "core_keluar");
  const kabelMasuk = alias(fiberCableSegments, "kabel_masuk");
  const kabelKeluar = alias(fiberCableSegments, "kabel_keluar");

  const kondisi = aktifSaja
    ? and(
        eq(fiberCoreSplices.closureId, closureId),
        isNull(fiberCoreSplices.deactivatedAt),
      )
    : eq(fiberCoreSplices.closureId, closureId);

  const splices = await db
    .select({
      id: fiberCoreSplices.id,
      inputCoreId: fiberCoreSplices.inputCoreId,
      inputCoreEnd: fiberCoreSplices.inputCoreEnd,
      inputCoreNumber: masuk.coreNumber,
      inputCoreColor: masuk.color,
      inputCablePurpose: masuk.purpose,
      inputCableCode: kabelMasuk.code,
      outputCoreId: fiberCoreSplices.outputCoreId,
      outputCoreEnd: fiberCoreSplices.outputCoreEnd,
      outputCoreNumber: keluar.coreNumber,
      outputCoreColor: keluar.color,
      outputCablePurpose: keluar.purpose,
      outputCableCode: kabelKeluar.code,
      estimatedLossDb: fiberCoreSplices.estimatedLossDb,
      reason: fiberCoreSplices.reason,
      deactivatedAt: fiberCoreSplices.deactivatedAt,
      deactivatedReason: fiberCoreSplices.deactivatedReason,
      createdAt: fiberCoreSplices.createdAt,
    })
    .from(fiberCoreSplices)
    .innerJoin(masuk, eq(masuk.id, fiberCoreSplices.inputCoreId))
    .innerJoin(keluar, eq(keluar.id, fiberCoreSplices.outputCoreId))
    .innerJoin(kabelMasuk, eq(kabelMasuk.id, masuk.segmentId))
    .innerJoin(kabelKeluar, eq(kabelKeluar.id, keluar.segmentId))
    .where(kondisi)
    .orderBy(asc(masuk.coreNumber));

  return {
    ...closure,
    splices: splices.map((s) => ({
      ...s,
      // Lurus atau silang — dihitung, bukan disimpan. Menyimpannya berarti
      // angka kedua tentang hal yang sama dengan dua nomor core di sebelahnya.
      silang: s.inputCoreNumber !== s.outputCoreNumber,
    })),
  };
}

// ---------------------------------------------------------------------------
// Tulis
// ---------------------------------------------------------------------------

export interface BuatClosureInput {
  code: string;
  name?: string | null;
  siteId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  type?: JenisClosure;
  notes?: string | null;
}

export async function buatClosure(
  input: BuatClosureInput,
  actorUserId: string | null,
): Promise<Hasil<{ id: string; code: string }>> {
  const code = input.code?.trim().toUpperCase();
  if (!code) return { ok: false, status: 400, error: "code wajib diisi." };

  const berkoordinat =
    typeof input.latitude === "number" && typeof input.longitude === "number";
  if (!input.siteId && !berkoordinat) {
    return {
      ok: false,
      status: 400,
      error:
        "Closure tanpa situs wajib punya latitude dan longitude — closure yang tidak bisa ditemukan di peta tidak menolong siapa pun saat gangguan.",
    };
  }

  const [bentrok] = await db
    .select({ id: fiberClosures.id })
    .from(fiberClosures)
    .where(eq(fiberClosures.code, code))
    .limit(1);
  if (bentrok) {
    return { ok: false, status: 409, error: `Kode closure ${code} sudah dipakai.` };
  }

  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(fiberClosures).values({
      id,
      code,
      name: input.name ?? null,
      siteId: input.siteId ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      type: input.type ?? "inline",
      notes: input.notes ?? null,
    });
    await catat(tx as unknown as typeof db, "fiber.closure.created", "fiber_closure", id, actorUserId, { code });
  });

  return { ok: true, data: { id, code } };
}

/**
 * Memeriksa satu batch silangan TANPA menulis apa pun.
 *
 * Dipakai oleh pratinjau DAN oleh commit — sengaja satu fungsi. Pratinjau
 * yang punya jalur validasinya sendiri akan menjanjikan sesuatu yang ditolak
 * commit, dan sesudah itu tidak ada yang mempercayai pratinjaunya lagi.
 */
export async function periksaBaris(
  closureId: string,
  baris: BarisSilangan[],
): Promise<{ closureAda: boolean; verdicts: VerdictBaris[] }> {
  const [closure] = await db
    .select({ id: fiberClosures.id, status: fiberClosures.status })
    .from(fiberClosures)
    .where(eq(fiberClosures.id, closureId))
    .limit(1);
  if (!closure) return { closureAda: false, verdicts: [] };

  const semuaCoreId = [
    ...new Set(baris.flatMap((b) => [b.inputCoreId, b.outputCoreId])),
  ];
  const cores = semuaCoreId.length
    ? await db
        .select({
          id: fiberCores.id,
          coreNumber: fiberCores.coreNumber,
          status: fiberCores.status,
          purpose: fiberCores.purpose,
          segmentCode: fiberCableSegments.code,
          segmentStatus: fiberCableSegments.status,
        })
        .from(fiberCores)
        .innerJoin(
          fiberCableSegments,
          eq(fiberCableSegments.id, fiberCores.segmentId),
        )
        .where(inArray(fiberCores.id, semuaCoreId))
    : [];
  const peta = new Map(cores.map((c) => [c.id, c]));

  // Ujung yang sudah dipakai sambungan AKTIF — baik sebagai masuk maupun
  // keluar. Dua index unik di tabelnya masing-masing hanya melihat satu
  // kolom, jadi keunikan lintas-kolom harus dijaga di sini.
  const dipakaiSplice = new Set<string>();
  if (semuaCoreId.length) {
    const rows = await db
      .select({
        inputCoreId: fiberCoreSplices.inputCoreId,
        inputCoreEnd: fiberCoreSplices.inputCoreEnd,
        outputCoreId: fiberCoreSplices.outputCoreId,
        outputCoreEnd: fiberCoreSplices.outputCoreEnd,
      })
      .from(fiberCoreSplices)
      .where(
        and(
          isNull(fiberCoreSplices.deactivatedAt),
          or(
            inArray(fiberCoreSplices.inputCoreId, semuaCoreId),
            inArray(fiberCoreSplices.outputCoreId, semuaCoreId),
          ),
        ),
      );
    for (const r of rows) {
      dipakaiSplice.add(kunci(r.inputCoreId, r.inputCoreEnd));
      dipakaiSplice.add(kunci(r.outputCoreId, r.outputCoreEnd));
    }
  }

  // Ujung yang sudah diterminasi di port — tabel LAIN, jadi tidak ada index
  // yang bisa menjaganya bersama tabel ini.
  const dipakaiTerminasi = new Set<string>();
  if (semuaCoreId.length) {
    const rows = await db
      .select({
        coreId: fiberCoreTerminations.coreId,
        coreEnd: fiberCoreTerminations.coreEnd,
      })
      .from(fiberCoreTerminations)
      .where(
        and(
          isNull(fiberCoreTerminations.deactivatedAt),
          inArray(fiberCoreTerminations.coreId, semuaCoreId),
        ),
      );
    for (const r of rows) dipakaiTerminasi.add(kunci(r.coreId, r.coreEnd));
  }

  const dipakaiBatch = new Set<string>();
  const verdicts: VerdictBaris[] = [];

  baris.forEach((b, i) => {
    const urutan = i + 1;
    const tolak = (error: string) => verdicts.push({ urutan, ok: false, error });

    if (closure.status !== "aktif") return tolak("Closure nonaktif.");
    if (b.inputCoreEnd !== "A" && b.inputCoreEnd !== "B") {
      return tolak("inputCoreEnd harus A atau B.");
    }
    if (b.outputCoreEnd !== "A" && b.outputCoreEnd !== "B") {
      return tolak("outputCoreEnd harus A atau B.");
    }
    if (b.inputCoreId === b.outputCoreId) {
      return tolak("Core tidak bisa disambung ke dirinya sendiri.");
    }

    const masuk = peta.get(b.inputCoreId);
    const keluar = peta.get(b.outputCoreId);
    if (!masuk) return tolak("Core masuk tidak ditemukan.");
    if (!keluar) return tolak("Core keluar tidak ditemukan.");
    if (masuk.status !== "baik") {
      return tolak(`Core masuk ${masuk.coreNumber} berstatus ${masuk.status}.`);
    }
    if (keluar.status !== "baik") {
      return tolak(`Core keluar ${keluar.coreNumber} berstatus ${keluar.status}.`);
    }
    if (masuk.segmentStatus !== "aktif") {
      return tolak(`Kabel ${masuk.segmentCode} nonaktif.`);
    }
    if (keluar.segmentStatus !== "aktif") {
      return tolak(`Kabel ${keluar.segmentCode} nonaktif.`);
    }

    const kMasuk = kunci(b.inputCoreId, b.inputCoreEnd);
    const kKeluar = kunci(b.outputCoreId, b.outputCoreEnd);
    if (kMasuk === kKeluar) {
      return tolak("Ujung masuk dan keluar tidak boleh sama.");
    }

    for (const [k, label, nomor] of [
      [kMasuk, "masuk", masuk.coreNumber],
      [kKeluar, "keluar", keluar.coreNumber],
    ] as const) {
      if (dipakaiSplice.has(k)) {
        // Inilah larangan membagi, dalam kalimat yang bisa ditindak.
        return tolak(
          `Ujung core ${label} (core ${nomor}) sudah punya sambungan aktif. Satu ujung core hanya boleh satu sambungan — pembagian hanya lewat master splitter.`,
        );
      }
      if (dipakaiTerminasi.has(k)) {
        return tolak(
          `Ujung core ${label} (core ${nomor}) sudah diterminasi ke sebuah port. Lepas terminasinya dulu.`,
        );
      }
      if (dipakaiBatch.has(k)) {
        return tolak(
          `Ujung core ${label} (core ${nomor}) dipakai lebih dari sekali dalam permintaan ini.`,
        );
      }
    }

    dipakaiBatch.add(kMasuk);
    dipakaiBatch.add(kKeluar);
    verdicts.push({
      urutan,
      ok: true,
      ...(masuk.coreNumber !== keluar.coreNumber
        ? { silangNomor: { dari: masuk.coreNumber, ke: keluar.coreNumber } }
        : {}),
    });
  });

  return { closureAda: true, verdicts };
}

/**
 * Memasang satu batch silangan — semua atau tidak sama sekali.
 *
 * Satu baris bentrok membatalkan seluruh batch. Menyimpan sebagian matriks
 * silangan menghasilkan closure yang setengah benar, dan itu lebih berbahaya
 * daripada closure yang belum diisi — karena ia terlihat sudah dikerjakan.
 */
export async function pasangSilangan(
  closureId: string,
  baris: BarisSilangan[],
  reason: string,
  actorUserId: string | null,
): Promise<Hasil<{ dipasang: number; ids: string[]; verdicts: VerdictBaris[] }>> {
  const alasan = reason?.trim();
  if (!alasan) {
    return {
      ok: false,
      status: 400,
      error: "reason wajib diisi — perubahan topologi tanpa alasan tidak bisa ditelusuri.",
    };
  }
  if (!Array.isArray(baris) || baris.length === 0) {
    return { ok: false, status: 400, error: "Tidak ada baris silangan yang dikirim." };
  }
  if (baris.length > MAKS_SILANGAN_PER_BATCH) {
    return {
      ok: false,
      status: 400,
      error: `Maksimal ${MAKS_SILANGAN_PER_BATCH} baris per permintaan.`,
    };
  }

  const { closureAda, verdicts } = await periksaBaris(closureId, baris);
  if (!closureAda) {
    return { ok: false, status: 404, error: "Closure tidak ditemukan." };
  }
  const gagal = verdicts.filter((v) => !v.ok);
  if (gagal.length > 0) {
    return {
      ok: false,
      status: 409,
      error: `${gagal.length} dari ${baris.length} baris ditolak; tidak ada yang disimpan. Baris ${gagal[0].urutan}: ${gagal[0].error}`,
    };
  }

  const ids = baris.map(() => randomUUID());
  try {
    await db.transaction(async (tx) => {
      await tx.insert(fiberCoreSplices).values(
        baris.map((b, i) => ({
          id: ids[i],
          closureId,
          inputCoreId: b.inputCoreId,
          inputCoreEnd: b.inputCoreEnd,
          outputCoreId: b.outputCoreId,
          outputCoreEnd: b.outputCoreEnd,
          estimatedLossDb: b.estimatedLossDb ?? null,
          reason: alasan,
        })),
      );
      await catat(tx as unknown as typeof db, "fiber.splice.created", "fiber_closure", closureId, actorUserId, {
        jumlah: baris.length,
        reason: alasan,
        spliceIds: ids,
      });
    });
  } catch (error) {
    const e = error as { code?: string; message?: string; cause?: unknown };
    let kini: unknown = e;
    for (let i = 0; i < 5 && kini; i += 1) {
      const c = kini as { code?: string; message?: string; cause?: unknown };
      if (c.code === "23505" || (c.message && /duplicate key|unique constraint/i.test(c.message))) {
        return {
          ok: false,
          status: 409,
          error: "Salah satu ujung core baru saja dipakai permintaan lain. Muat ulang lalu coba lagi; tidak ada yang disimpan.",
        };
      }
      kini = c.cause;
    }
    throw error;
  }

  return { ok: true, data: { dipasang: baris.length, ids, verdicts } };
}

/** Melepas satu silangan — barisnya TIDAK dihapus. */
export async function lepasSilangan(
  spliceId: string,
  reason: string,
  actorUserId: string | null,
): Promise<Hasil<{ id: string }>> {
  const alasan = reason?.trim();
  if (!alasan) return { ok: false, status: 400, error: "reason wajib diisi." };

  const [row] = await db
    .select()
    .from(fiberCoreSplices)
    .where(eq(fiberCoreSplices.id, spliceId))
    .limit(1);
  if (!row) return { ok: false, status: 404, error: "Silangan tidak ditemukan." };
  if (row.deactivatedAt) {
    return { ok: false, status: 409, error: "Silangan itu sudah dilepas." };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(fiberCoreSplices)
      .set({
        deactivatedAt: new Date(),
        deactivatedReason: alasan,
        updatedAt: new Date(),
      })
      .where(eq(fiberCoreSplices.id, spliceId));
    await catat(tx as unknown as typeof db, "fiber.splice.released", "fiber_splice", spliceId, actorUserId, {
      closureId: row.closureId,
      reason: alasan,
    });
  });

  return { ok: true, data: { id: spliceId } };
}
