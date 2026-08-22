// Riwayat topologi (Fase 16).
//
// Tidak ada tabel baru. Seluruh riwayat sudah tertulis di `audit_logs` sejak
// Fase 11 — tiap mutasi topologi menulis barisnya di dalam transaksi yang
// sama, jadi kegagalan audit membatalkan mutasinya. Yang kurang selama ini
// cuma cara membacanya.
//
// DUA HAL YANG MENENTUKAN BENTUK BERKAS INI:
//
// 1. Riwayat sebuah OTB bukan cuma peristiwa pada baris `otb`-nya. Yang
//    dicari orang saat gangguan adalah "apa yang pernah terjadi pada rak
//    ini" — termasuk tray dan portnya. Karena itu ruang lingkupnya
//    dikembangkan, bukan disaring mentah per `entity_id`.
//
// 2. Kalimatnya dirakit DI SINI, bukan di layar. Kalau tiap layar menerjemah
//    sendiri `action` jadi kalimat, dua layar akan menjelaskan peristiwa yang
//    sama dengan dua cara berbeda — dan yang satu akan salah lebih dulu.

import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import {
  auditLogs,
  fiberCableSegments,
  fiberCoreSplices,
  fiberCoreTerminations,
  fiberCores,
  otbPorts,
  otbTrays,
} from "@/db/schema";

export const JENIS_TOPOLOGI = [
  "otb",
  "otb_tray",
  "otb_port",
  "fiber_cable",
  "fiber_core",
  "fiber_termination",
  "fiber_closure",
  "fiber_splice",
  "olt_device",
] as const;
export type JenisEntitas = (typeof JENIS_TOPOLOGI)[number];

export const MAKS_BARIS = 100;

/**
 * Kalimat untuk tiap `action`, dalam bentuk lampau dan bisa dibaca operator.
 *
 * Aksi yang tidak dikenal TIDAK disembunyikan — ia tampil apa adanya. Riwayat
 * yang diam-diam membuang peristiwa yang tidak dikenalnya lebih buruk daripada
 * riwayat yang menampilkan kode mentah: yang pertama terlihat lengkap.
 */
const KALIMAT: Record<string, string> = {
  "otb.created": "OTB dibuat",
  "otb.updated": "Atribut OTB diubah",
  "otb.port.updated": "Status port diubah",
  "otb.port.terminated": "Core dipasang ke port",
  "otb.port.released": "Core dilepas dari port",
  "otb.tray.capacity_changed": "Kapasitas tray diubah",
  "fiber.cable.created": "Kabel dibuat",
  "fiber.core.terminated": "Ujung core diterminasi",
  "fiber.core.released": "Terminasi core dilepas",
  "fiber.closure.created": "Closure dibuat",
  "fiber.splice.created": "Silangan core dipasang",
  "fiber.splice.released": "Silangan core dilepas",
  "olt.address_fixed": "Alamat OLT diperbaiki",
};

export interface BarisRiwayat {
  id: string;
  waktu: Date;
  action: string;
  /** Kalimat siap tampil; sama dengan `action` kalau belum punya terjemahan. */
  ringkas: string;
  entityType: string;
  entityId: string;
  /** Nama pengguna, atau "sistem" untuk aksi worker/webhook. */
  oleh: string;
  detail: Record<string, unknown> | null;
}

export interface HasilRiwayat {
  baris: BarisRiwayat[];
  /** Penanda untuk permintaan berikutnya; null kalau sudah habis. */
  berikutnya: string | null;
}

/**
 * Ruang lingkup sebuah entitas — dirinya sendiri plus yang menempel padanya.
 *
 * OTB membawa tray dan portnya; kabel membawa core, terminasi, dan silangan
 * yang menyentuhnya; closure membawa silangannya. Tanpa ini, "riwayat OTB"
 * hanya berisi pembuatannya sendiri — satu baris, dan tidak berguna.
 */
export async function lingkupEntitas(
  jenis: JenisEntitas,
  id: string,
): Promise<Array<{ entityType: string; entityId: string }>> {
  const lingkup: Array<{ entityType: string; entityId: string }> = [
    { entityType: jenis, entityId: id },
  ];

  if (jenis === "otb") {
    const trays = await db
      .select({ id: otbTrays.id })
      .from(otbTrays)
      .where(eq(otbTrays.otbId, id));
    const ports = await db
      .select({ id: otbPorts.id })
      .from(otbPorts)
      .where(eq(otbPorts.otbId, id));
    for (const t of trays) lingkup.push({ entityType: "otb_tray", entityId: t.id });
    for (const p of ports) lingkup.push({ entityType: "otb_port", entityId: p.id });
  }

  if (jenis === "fiber_cable") {
    const cores = await db
      .select({ id: fiberCores.id })
      .from(fiberCores)
      .where(eq(fiberCores.segmentId, id));
    const coreIds = cores.map((c) => c.id);
    for (const c of coreIds) lingkup.push({ entityType: "fiber_core", entityId: c });
    if (coreIds.length > 0) {
      const term = await db
        .select({ id: fiberCoreTerminations.id })
        .from(fiberCoreTerminations)
        .where(inArray(fiberCoreTerminations.coreId, coreIds));
      for (const t of term) lingkup.push({ entityType: "fiber_termination", entityId: t.id });
      const splice = await db
        .select({ id: fiberCoreSplices.id })
        .from(fiberCoreSplices)
        .where(
          or(
            inArray(fiberCoreSplices.inputCoreId, coreIds),
            inArray(fiberCoreSplices.outputCoreId, coreIds),
          ),
        );
      for (const s of splice) lingkup.push({ entityType: "fiber_splice", entityId: s.id });
    }
  }

  if (jenis === "fiber_closure") {
    const splice = await db
      .select({ id: fiberCoreSplices.id })
      .from(fiberCoreSplices)
      .where(eq(fiberCoreSplices.closureId, id));
    for (const s of splice) lingkup.push({ entityType: "fiber_splice", entityId: s.id });
    // Silangan yang dipasang lewat batch dicatat pada closure-nya, bukan pada
    // tiap barisnya — jadi `fiber_closure` sendiri sudah termasuk di atas.
  }

  return lingkup;
}

function rapikan(r: {
  id: string;
  createdAt: Date;
  action: string;
  entityType: string;
  entityId: string;
  actorLabel: string;
  actorName: string | null;
  detail: Record<string, unknown> | null;
}): BarisRiwayat {
  return {
    id: r.id,
    waktu: r.createdAt,
    action: r.action,
    ringkas: KALIMAT[r.action] ?? r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    oleh: r.actorName ?? (r.actorLabel === "user" ? "pengguna terhapus" : "sistem"),
    detail: r.detail,
  };
}

const KOLOM = {
  id: auditLogs.id,
  createdAt: auditLogs.createdAt,
  action: auditLogs.action,
  entityType: auditLogs.entityType,
  entityId: auditLogs.entityId,
  actorLabel: auditLogs.actorLabel,
  actorName: user.name,
  detail: auditLogs.detail,
};

/**
 * Penanda halaman: waktu + id.
 *
 * Waktu saja tidak cukup — pemasangan silangan massal menulis beberapa baris
 * pada milidetik yang sama, dan penanda berbasis waktu akan melewatkan
 * sebagiannya atau mengulangnya.
 */
function uraikanPenanda(p: string | null) {
  if (!p) return null;
  const [waktu, id] = p.split("|");
  const t = new Date(waktu);
  if (Number.isNaN(t.getTime()) || !id) return null;
  return { waktu: t, id };
}

function buatPenanda(b: BarisRiwayat) {
  return `${b.waktu.toISOString()}|${b.id}`;
}

export async function riwayatTopologi(opsi: {
  jenis?: JenisEntitas;
  id?: string;
  limit?: number;
  sesudah?: string | null;
}): Promise<HasilRiwayat> {
  const limit = Math.min(Math.max(1, opsi.limit ?? 30), MAKS_BARIS);
  const penanda = uraikanPenanda(opsi.sesudah ?? null);

  const syarat = [];
  if (opsi.jenis && opsi.id) {
    const lingkup = await lingkupEntitas(opsi.jenis, opsi.id);
    syarat.push(
      or(
        ...lingkup.map((l) =>
          and(eq(auditLogs.entityType, l.entityType), eq(auditLogs.entityId, l.entityId)),
        ),
      ),
    );
  } else {
    syarat.push(inArray(auditLogs.entityType, [...JENIS_TOPOLOGI]));
  }
  if (penanda) {
    syarat.push(
      or(
        lt(auditLogs.createdAt, penanda.waktu),
        and(eq(auditLogs.createdAt, penanda.waktu), lt(auditLogs.id, penanda.id)),
      ),
    );
  }

  const rows = await db
    .select(KOLOM)
    .from(auditLogs)
    .leftJoin(user, eq(user.id, auditLogs.actorUserId))
    .where(and(...syarat))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(limit + 1);

  const baris = rows.slice(0, limit).map(rapikan);
  return {
    baris,
    berikutnya: rows.length > limit && baris.length > 0 ? buatPenanda(baris[baris.length - 1]) : null,
  };
}
