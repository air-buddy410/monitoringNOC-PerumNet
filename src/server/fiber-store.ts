// Kabel, core, dan terminasi core (Fase 12).
//
// Perbedaan penting dari Fase 11: di sini okupansi ditegakkan DATABASE, bukan
// kode. Ketiga pemeriksaan di bawah punya partial unique index pasangannya di
// `fiber_core_terminations`. Pemeriksaan kode tetap ada supaya pesannya bisa
// dibaca manusia — tapi kalau dua operator menekan simpan pada milidetik yang
// sama, yang menolak adalah PostgreSQL, dan itu memang satu-satunya lapisan
// yang bisa.

import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  WARNA_CORE,
  auditLogs,
  fiberCableSegments,
  fiberCoreTerminations,
  fiberCores,
  odpPorts,
  odps,
  otb,
  otbPorts,
  otbTrays,
} from "@/db/schema";

export type KategoriKabel =
  | "backbone"
  | "feeder"
  | "distribution"
  | "dropcore"
  | "interconnect"
  | "lain";
export type JenisSerat = "G.652D" | "G.657A1" | "G.657A2" | "lain";
export type PeruntukanCore = "feeder" | "distribution";
export type UjungCore = "A" | "B";

export const MAKS_CORE = 288;

export type Hasil<T> =
  | { ok: true; data: T }
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * Warna core menurut urutan standar, berulang tiap 12.
 *
 * Hanya dipakai saat kabel DIBUAT. Sesudah itu warnanya kolom yang bisa
 * ditimpa — yang tercetak di kabel selalu lebih benar daripada standar.
 */
export function warnaCore(coreNumber: number): string {
  return WARNA_CORE[(coreNumber - 1) % WARNA_CORE.length];
}

/**
 * Apakah galat ini penolakan unique index?
 *
 * Harus menelusuri rantai `cause`: Drizzle membungkus galat driver menjadi
 * "Failed query: insert into …", dan kode PostgreSQL yang sebenarnya (23505)
 * ada di dalamnya. Mencocokkan hanya pesan terluar membuat penolakan okupansi
 * lolos sebagai galat 500 yang tidak bisa dijelaskan kepada operator.
 */
function penolakanUnik(error: unknown): boolean {
  let kini: unknown = error;
  for (let i = 0; i < 5 && kini; i += 1) {
    const e = kini as { code?: string; message?: string; cause?: unknown };
    if (e.code === "23505") return true;
    if (e.message && /duplicate key|unique constraint/i.test(e.message)) return true;
    kini = e.cause;
  }
  return false;
}

async function catat(
  executor: typeof db,
  action: string,
  entityType: "fiber_cable" | "fiber_core" | "fiber_termination" | "otb_port" | "otb",
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

// ---------------------------------------------------------------------------
// Baca
// ---------------------------------------------------------------------------

export async function daftarKabel() {
  return db
    .select({
      id: fiberCableSegments.id,
      code: fiberCableSegments.code,
      name: fiberCableSegments.name,
      category: fiberCableSegments.category,
      fiberType: fiberCableSegments.fiberType,
      coreCount: fiberCableSegments.coreCount,
      lengthM: fiberCableSegments.lengthM,
      status: fiberCableSegments.status,
      coreTerpasang: sql<number>`count(distinct ${fiberCores.id})::int`,
      coreFeeder: sql<number>`count(distinct ${fiberCores.id}) filter (where ${fiberCores.purpose} = 'feeder')::int`,
      coreDistribution: sql<number>`count(distinct ${fiberCores.id}) filter (where ${fiberCores.purpose} = 'distribution')::int`,
      coreRusak: sql<number>`count(distinct ${fiberCores.id}) filter (where ${fiberCores.status} = 'rusak')::int`,
    })
    .from(fiberCableSegments)
    .leftJoin(fiberCores, eq(fiberCores.segmentId, fiberCableSegments.id))
    .groupBy(fiberCableSegments.id)
    .orderBy(asc(fiberCableSegments.code));
}

export async function detailKabel(cableId: string) {
  const [kabel] = await db
    .select()
    .from(fiberCableSegments)
    .where(eq(fiberCableSegments.id, cableId))
    .limit(1);
  if (!kabel) return null;

  const cores = await db
    .select({
      id: fiberCores.id,
      coreNumber: fiberCores.coreNumber,
      tubeNumber: fiberCores.tubeNumber,
      color: fiberCores.color,
      purpose: fiberCores.purpose,
      label: fiberCores.label,
      status: fiberCores.status,
      notes: fiberCores.notes,
      // Ujung mana yang sudah terpakai — diturunkan dari terminasi AKTIF.
      ujungTerpakai: sql<string[]>`coalesce(array_agg(${fiberCoreTerminations.coreEnd}) filter (where ${fiberCoreTerminations.id} is not null), '{}')`,
    })
    .from(fiberCores)
    .leftJoin(
      fiberCoreTerminations,
      and(
        eq(fiberCoreTerminations.coreId, fiberCores.id),
        isNull(fiberCoreTerminations.deactivatedAt),
      ),
    )
    .where(eq(fiberCores.segmentId, cableId))
    .groupBy(fiberCores.id)
    .orderBy(asc(fiberCores.coreNumber));

  return { ...kabel, cores };
}

/**
 * Seluruh terminasi sebuah core, termasuk yang sudah dilepas.
 *
 * Histori tidak pernah dihapus, dan justru yang sudah dilepas itulah yang
 * dicari orang saat gangguan — "jalur ini dulu menempel di mana".
 *
 * Label port ikut dirakit di sini, bukan diserahkan ke layar. Kalau frontend
 * harus mencari sendiri nama OTB dan nomor tray untuk tiap baris riwayat, ia
 * akan memanggil endpoint lain sekali per baris — dan riwayat panjang berubah
 * jadi puluhan permintaan untuk satu panel.
 */
export async function riwayatTerminasiCore(coreId: string) {
  const rows = await db
    .select({
      id: fiberCoreTerminations.id,
      coreEnd: fiberCoreTerminations.coreEnd,
      otbPortId: fiberCoreTerminations.otbPortId,
      odpPortId: fiberCoreTerminations.odpPortId,
      reason: fiberCoreTerminations.reason,
      deactivatedAt: fiberCoreTerminations.deactivatedAt,
      deactivatedReason: fiberCoreTerminations.deactivatedReason,
      createdAt: fiberCoreTerminations.createdAt,
      otbCode: otb.code,
      trayNumber: otbTrays.trayNumber,
      portNumberInTray: otbPorts.portNumberInTray,
      globalPortNumber: otbPorts.globalPortNumber,
      odpCode: odps.code,
      odpRole: odps.role,
      odpPortNumber: odpPorts.portNumber,
    })
    .from(fiberCoreTerminations)
    .leftJoin(otbPorts, eq(otbPorts.id, fiberCoreTerminations.otbPortId))
    .leftJoin(otbTrays, eq(otbTrays.id, otbPorts.trayId))
    .leftJoin(otb, eq(otb.id, otbPorts.otbId))
    .leftJoin(odpPorts, eq(odpPorts.id, fiberCoreTerminations.odpPortId))
    .leftJoin(odps, eq(odps.id, odpPorts.odpId))
    .where(eq(fiberCoreTerminations.coreId, coreId))
    .orderBy(asc(fiberCoreTerminations.createdAt));

  return rows.map((r) => ({
    id: r.id,
    coreEnd: r.coreEnd,
    otbPortId: r.otbPortId,
    odpPortId: r.odpPortId,
    reason: r.reason,
    deactivatedAt: r.deactivatedAt,
    deactivatedReason: r.deactivatedReason,
    createdAt: r.createdAt,
    aktif: r.deactivatedAt === null,
    /** Sasaran dalam bentuk yang bisa langsung ditampilkan. */
    sasaran: r.otbPortId
      ? {
          jenis: "otbPort" as const,
          label: `${r.otbCode ?? "?"} · Tray ${r.trayNumber ?? "?"} port ${r.portNumberInTray ?? "?"}`,
          otbCode: r.otbCode,
          trayNumber: r.trayNumber,
          portNumberInTray: r.portNumberInTray,
          globalPortNumber: r.globalPortNumber,
        }
      : {
          jenis: "odpPort" as const,
          label: `${r.odpCode ?? "?"} · port ${r.odpPortNumber ?? "?"}`,
          odpCode: r.odpCode,
          odpRole: r.odpRole,
          portNumber: r.odpPortNumber,
        },
  }));
}

// ---------------------------------------------------------------------------
// Tulis
// ---------------------------------------------------------------------------

export interface BuatKabelInput {
  code: string;
  name?: string | null;
  category: KategoriKabel;
  fiberType?: JenisSerat;
  coreCount: number;
  lengthM?: number | null;
  purpose?: PeruntukanCore;
  notes?: string | null;
}

/**
 * Membuat kabel beserta seluruh core-nya dalam satu transaksi.
 *
 * `purpose` di sini mengisi SELURUH core sekaligus, karena itu keadaan yang
 * paling umum. Core yang menyimpang diubah satu per satu sesudahnya — bukan
 * ditebak dari nomornya.
 */
export async function buatKabel(
  input: BuatKabelInput,
  actorUserId: string | null,
): Promise<Hasil<{ id: string; code: string; coreCount: number }>> {
  const code = input.code?.trim().toUpperCase();
  if (!code) return { ok: false, status: 400, error: "code wajib diisi." };

  if (
    !Number.isInteger(input.coreCount) ||
    input.coreCount < 1 ||
    input.coreCount > MAKS_CORE
  ) {
    return { ok: false, status: 400, error: `coreCount harus 1–${MAKS_CORE}.` };
  }
  if (
    input.lengthM !== undefined &&
    input.lengthM !== null &&
    (!Number.isInteger(input.lengthM) || input.lengthM < 0)
  ) {
    return {
      ok: false,
      status: 400,
      error: "lengthM harus bilangan bulat meter, atau dikosongkan kalau belum diukur.",
    };
  }

  const [bentrok] = await db
    .select({ id: fiberCableSegments.id })
    .from(fiberCableSegments)
    .where(eq(fiberCableSegments.code, code))
    .limit(1);
  if (bentrok) {
    return { ok: false, status: 409, error: `Kode kabel ${code} sudah dipakai.` };
  }

  const purpose: PeruntukanCore =
    input.purpose ?? (input.category === "distribution" || input.category === "dropcore"
      ? "distribution"
      : "feeder");

  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(fiberCableSegments).values({
      id,
      code,
      name: input.name ?? null,
      category: input.category,
      fiberType: input.fiberType ?? "G.652D",
      coreCount: input.coreCount,
      lengthM: input.lengthM ?? null,
      notes: input.notes ?? null,
    });
    await tx.insert(fiberCores).values(
      Array.from({ length: input.coreCount }, (_, i) => ({
        id: randomUUID(),
        segmentId: id,
        coreNumber: i + 1,
        color: warnaCore(i + 1),
        purpose,
      })),
    );
    await catat(tx as unknown as typeof db, "fiber.cable.created", "fiber_cable", id, actorUserId, {
      code,
      category: input.category,
      coreCount: input.coreCount,
      purpose,
    });
  });

  return { ok: true, data: { id, code, coreCount: input.coreCount } };
}

export interface TerminasiInput {
  coreId: string;
  coreEnd: UjungCore;
  otbPortId?: string | null;
  odpPortId?: string | null;
  reason: string;
}

/**
 * Menerminasi satu ujung core ke sebuah port.
 *
 * Urutan pemeriksaannya bukan selera: yang paling murah dan paling sering
 * salah diperiksa lebih dulu, supaya pesan galatnya menyebut sebab yang
 * sebenarnya, bukan gejala yang muncul belakangan.
 *
 * Yang TIDAK dilakukan di sini: menebak. Kalau port tujuan tidak kosong,
 * terminasi ditolak — bukan diam-diam menggeser ke port berikutnya.
 */
export async function terminasiCore(
  input: TerminasiInput,
  actorUserId: string | null,
): Promise<Hasil<{ id: string; coreId: string; coreEnd: UjungCore }>> {
  const reason = input.reason?.trim();
  if (!reason) {
    return {
      ok: false,
      status: 400,
      error: "reason wajib diisi — perubahan topologi tanpa alasan tidak bisa ditelusuri.",
    };
  }
  if (input.coreEnd !== "A" && input.coreEnd !== "B") {
    return { ok: false, status: 400, error: "coreEnd harus A atau B." };
  }

  const keOtb = Boolean(input.otbPortId);
  const keOdp = Boolean(input.odpPortId);
  if (keOtb === keOdp) {
    return {
      ok: false,
      status: 400,
      error: "Isi tepat satu: otbPortId ATAU odpPortId.",
    };
  }

  const [core] = await db
    .select({
      id: fiberCores.id,
      coreNumber: fiberCores.coreNumber,
      purpose: fiberCores.purpose,
      status: fiberCores.status,
      segmentId: fiberCores.segmentId,
      segmentCode: fiberCableSegments.code,
      segmentStatus: fiberCableSegments.status,
    })
    .from(fiberCores)
    .innerJoin(
      fiberCableSegments,
      eq(fiberCableSegments.id, fiberCores.segmentId),
    )
    .where(eq(fiberCores.id, input.coreId))
    .limit(1);
  if (!core) return { ok: false, status: 404, error: "Core tidak ditemukan." };
  if (core.status !== "baik") {
    return {
      ok: false,
      status: 409,
      error: `Core ${core.coreNumber} berstatus ${core.status} — tidak bisa diterminasi.`,
    };
  }
  if (core.segmentStatus !== "aktif") {
    return {
      ok: false,
      status: 409,
      error: `Kabel ${core.segmentCode} nonaktif — aktifkan dulu.`,
    };
  }

  let portId: string;
  let jenisPort: "otb_port" | "odp_port";

  if (keOtb) {
    const [port] = await db
      .select({
        id: otbPorts.id,
        status: otbPorts.status,
        globalPortNumber: otbPorts.globalPortNumber,
        otbCode: otb.code,
        otbStatus: otb.status,
      })
      .from(otbPorts)
      .innerJoin(otb, eq(otb.id, otbPorts.otbId))
      .where(eq(otbPorts.id, input.otbPortId!))
      .limit(1);
    if (!port) return { ok: false, status: 404, error: "Port OTB tidak ditemukan." };
    if (port.otbStatus !== "aktif") {
      return { ok: false, status: 409, error: `OTB ${port.otbCode} nonaktif.` };
    }
    if (port.status !== "kosong") {
      return {
        ok: false,
        status: 409,
        error: `Port ${port.globalPortNumber} pada OTB ${port.otbCode} berstatus ${port.status}.`,
      };
    }
    portId = port.id;
    jenisPort = "otb_port";
  } else {
    const [port] = await db
      .select({
        id: odpPorts.id,
        status: odpPorts.status,
        portNumber: odpPorts.portNumber,
        odpId: odps.id,
        odpCode: odps.code,
        odpRole: odps.role,
      })
      .from(odpPorts)
      .innerJoin(odps, eq(odps.id, odpPorts.odpId))
      .where(eq(odpPorts.id, input.odpPortId!))
      .limit(1);
    if (!port) return { ok: false, status: 404, error: "Port ODP tidak ditemukan." };
    if (port.status !== "kosong") {
      return {
        ok: false,
        status: 409,
        error: `Port ${port.portNumber} pada ${port.odpCode} berstatus ${port.status}.`,
      };
    }
    // PRD §3 aturan 1: ODP adalah ujung distribusi. Core feeder yang berakhir
    // di ODP berarti jalurnya salah gambar, bukan sekadar salah label.
    if (port.odpRole === "ODP" && core.purpose !== "distribution") {
      return {
        ok: false,
        status: 409,
        error: `Core ${core.coreNumber} berperuntukan ${core.purpose}; port ODP hanya menerima core distribution.`,
      };
    }

    // Satu master splitter, satu input feeder.
    //
    // Ini bukan kerapian: mesin trace membedakan input dari output SEMATA
    // dari peruntukan core yang menempel (`trace-store.ts`). Splitter dengan
    // dua core feeder membuat pembedaan itu ambigu, dan telusur balik dari
    // ODP akan menyeberang ke jalur yang tidak pernah dilewati cahaya.
    // Ditegakkan di sini karena `odp_ports` tidak punya penanda arah —
    // menambahkannya berarti mengubah tabel dengan 8.632 baris produksi.
    if (port.odpRole === "MS" && core.purpose === "feeder") {
      const [feederLain] = await db
        .select({ id: fiberCoreTerminations.id })
        .from(fiberCoreTerminations)
        .innerJoin(fiberCores, eq(fiberCores.id, fiberCoreTerminations.coreId))
        .innerJoin(odpPorts, eq(odpPorts.id, fiberCoreTerminations.odpPortId))
        .where(
          and(
            eq(odpPorts.odpId, port.odpId),
            eq(fiberCores.purpose, "feeder"),
            isNull(fiberCoreTerminations.deactivatedAt),
          ),
        )
        .limit(1);
      if (feederLain) {
        return {
          ok: false,
          status: 409,
          error: `${port.odpCode} sudah punya input feeder aktif. Master splitter hanya boleh punya satu input — lepas yang lama dulu.`,
        };
      }
    }
    portId = port.id;
    jenisPort = "odp_port";
  }

  const id = randomUUID();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(fiberCoreTerminations).values({
        id,
        coreId: core.id,
        coreEnd: input.coreEnd,
        otbPortId: keOtb ? portId : null,
        odpPortId: keOdp ? portId : null,
        reason,
      });

      if (jenisPort === "otb_port") {
        await tx
          .update(otbPorts)
          .set({ status: "terpakai", updatedAt: new Date() })
          .where(eq(otbPorts.id, portId));
        // Jejak pada PORT-nya, bukan hanya pada terminasinya. Aturan penurunan
        // kapasitas tray di Fase 11 membaca baris audit ber-entityType
        // `otb_port`; tanpa baris ini, port yang pernah membawa core lalu
        // dilepas akan terlihat perawan dan bisa dihapus beserta riwayatnya.
        await catat(tx as unknown as typeof db, "otb.port.terminated", "otb_port", portId, actorUserId, {
          coreId: core.id,
          coreEnd: input.coreEnd,
          terminationId: id,
        });
      } else {
        await tx
          .update(odpPorts)
          .set({ status: "terpakai", updatedAt: new Date() })
          .where(eq(odpPorts.id, portId));
      }

      await catat(tx as unknown as typeof db, "fiber.core.terminated", "fiber_termination", id, actorUserId, {
        coreId: core.id,
        coreNumber: core.coreNumber,
        coreEnd: input.coreEnd,
        segmentCode: core.segmentCode,
        jenisPort,
        portId,
        reason,
      });
    });
  } catch (error) {
    // Partial unique index yang menolak. Kode di atas sudah memeriksa hal yang
    // sama, jadi sampai di sini berarti ada permintaan lain yang menang balapan
    // di antara pemeriksaan dan penulisan — dan itu justru bukti index-nya
    // bekerja.
    if (penolakanUnik(error)) {
      return {
        ok: false,
        status: 409,
        error: "Ujung core atau port itu baru saja dipakai permintaan lain. Muat ulang lalu coba lagi.",
      };
    }
    throw error;
  }

  return { ok: true, data: { id, coreId: core.id, coreEnd: input.coreEnd } };
}

/**
 * Melepas terminasi — TIDAK menghapusnya.
 *
 * Baris lama diberi `deactivated_at`; karena index okupansinya parsial, ia
 * otomatis keluar dari perhitungan tanpa perlu dihapus. Riwayat "core ini
 * pernah menempel di sini, dilepas tanggal sekian, alasannya ini" adalah
 * separuh nilai modul ini saat gangguan.
 */
export async function lepasTerminasi(
  terminationId: string,
  reason: string,
  actorUserId: string | null,
): Promise<Hasil<{ id: string }>> {
  const alasan = reason?.trim();
  if (!alasan) {
    return { ok: false, status: 400, error: "reason wajib diisi." };
  }

  const [term] = await db
    .select()
    .from(fiberCoreTerminations)
    .where(eq(fiberCoreTerminations.id, terminationId))
    .limit(1);
  if (!term) return { ok: false, status: 404, error: "Terminasi tidak ditemukan." };
  if (term.deactivatedAt) {
    return { ok: false, status: 409, error: "Terminasi itu sudah dilepas." };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(fiberCoreTerminations)
      .set({
        deactivatedAt: new Date(),
        deactivatedReason: alasan,
        updatedAt: new Date(),
      })
      .where(eq(fiberCoreTerminations.id, terminationId));

    if (term.otbPortId) {
      await tx
        .update(otbPorts)
        .set({ status: "kosong", updatedAt: new Date() })
        .where(eq(otbPorts.id, term.otbPortId));
      await catat(tx as unknown as typeof db, "otb.port.released", "otb_port", term.otbPortId, actorUserId, {
        terminationId,
        reason: alasan,
      });
    }
    if (term.odpPortId) {
      await tx
        .update(odpPorts)
        .set({ status: "kosong", updatedAt: new Date() })
        .where(eq(odpPorts.id, term.odpPortId));
    }

    await catat(tx as unknown as typeof db, "fiber.core.released", "fiber_termination", terminationId, actorUserId, {
      coreId: term.coreId,
      coreEnd: term.coreEnd,
      reason: alasan,
    });
  });

  return { ok: true, data: { id: terminationId } };
}

export interface UbahOtbInput {
  name?: string;
  siteId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  status?: "aktif" | "nonaktif";
  notes?: string | null;
  defaultConnectorType?: "SC" | "LC";
  defaultPolish?: "UPC" | "APC";
}

/**
 * Mengubah atribut OTB — bukan kapasitasnya.
 *
 * Kapasitas punya jalur sendiri (`PATCH …/trays/:n`) karena ia satu-satunya
 * operasi yang menghapus baris, dan aturannya jauh lebih ketat.
 */
export async function ubahOtb(
  otbId: string,
  patch: UbahOtbInput,
  actorUserId: string | null,
): Promise<Hasil<{ id: string; code: string }>> {
  const [sebelum] = await db.select().from(otb).where(eq(otb.id, otbId)).limit(1);
  if (!sebelum) return { ok: false, status: 404, error: "OTB tidak ditemukan." };

  const siteId = patch.siteId !== undefined ? patch.siteId : sebelum.siteId;
  const latitude = patch.latitude !== undefined ? patch.latitude : sebelum.latitude;
  const longitude = patch.longitude !== undefined ? patch.longitude : sebelum.longitude;
  if (!siteId && (latitude === null || longitude === null)) {
    return {
      ok: false,
      status: 400,
      error: "OTB tanpa situs wajib punya latitude dan longitude, kalau tidak ia tidak akan pernah muncul di peta.",
    };
  }

  const perubahan: Record<string, unknown> = { updatedAt: new Date() };
  for (const kunci of [
    "name",
    "siteId",
    "latitude",
    "longitude",
    "status",
    "notes",
    "defaultConnectorType",
    "defaultPolish",
  ] as const) {
    if (patch[kunci] !== undefined) perubahan[kunci] = patch[kunci];
  }

  await db.transaction(async (tx) => {
    await tx.update(otb).set(perubahan).where(eq(otb.id, otbId));
    await catat(tx as unknown as typeof db, "otb.updated", "otb", otbId, actorUserId, {
      sebelum: {
        name: sebelum.name,
        siteId: sebelum.siteId,
        status: sebelum.status,
      },
      sesudah: patch,
    });
  });

  return { ok: true, data: { id: otbId, code: sebelum.code } };
}
