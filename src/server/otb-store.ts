// OTB, tray, dan port fisik (Fase 11).
//
// Seluruh aturan domain OTB tinggal di berkas ini; route hanya menerjemahkan
// HTTP. Alasannya bukan kerapian: aturan "port yang punya histori tidak boleh
// dihapus" harus berlaku sama dari route mana pun ia dipanggil, dan aturan
// yang ditulis di dalam handler hanya berlaku untuk handler itu.

import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  STATUS_PORT_OTB,
  auditLogs,
  networkSites,
  otb,
  otbPorts,
  otbTrays,
} from "@/db/schema";

export type TipeKonektor = "SC" | "LC";
export type Polish = "UPC" | "APC";
export type StatusPortOtb = (typeof STATUS_PORT_OTB)[number];

/** Satu-satunya tempat "apakah ini status yang sah" dijawab. */
export function statusPortSah(nilai: unknown): nilai is StatusPortOtb {
  return (
    typeof nilai === "string" &&
    (STATUS_PORT_OTB as readonly string[]).includes(nilai)
  );
}
export type StatusTray = "terhubung" | "sebagian" | "kosong" | "nonaktif";

/**
 * Kapasitas bawaan per tray menurut konektornya (PRD FR-OTB-002).
 *
 * Ini default APLIKASI, bukan batas database. Pemanggil boleh memberi angka
 * lain dan skema tidak menghalanginya — rak 96 core misalnya bisa berupa
 * 8 tray SC (12 port) atau 4 tray LC (24 port), dan varian lain memang ada
 * di lapangan.
 */
export const KAPASITAS_BAWAAN: Record<TipeKonektor, number> = { SC: 12, LC: 24 };

/** Batas atas yang sama dengan `POST /api/v1/ftth/odps`, supaya satu OTB tidak
 *  bisa membangkitkan jutaan baris port dari satu permintaan. */
export const MAKS_PORT_PER_TRAY = 256;
export const MAKS_TRAY = 64;

export type HasilOtb<T> =
  | { ok: true; data: T }
  | { ok: false; status: 400 | 404 | 409; error: string };

async function writeAudit(
  executor: typeof db,
  action: string,
  entityType: "otb" | "otb_tray" | "otb_port",
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

/**
 * Ringkasan status sebuah tray, DITURUNKAN dari baris port.
 *
 * Tidak disimpan sebagai kolom: lencana yang disimpan akan basi diam-diam
 * setiap kali satu port berubah lewat jalur yang lupa memperbaruinya.
 */
export function statusTray(
  aktif: boolean,
  totalPort: number,
  portTerpakai: number,
): StatusTray {
  if (!aktif) return "nonaktif";
  if (totalPort === 0 || portTerpakai === 0) return "kosong";
  if (portTerpakai >= totalPort) return "terhubung";
  return "sebagian";
}

export async function daftarOtb() {
  const rows = await db
    .select({
      id: otb.id,
      code: otb.code,
      name: otb.name,
      siteId: otb.siteId,
      siteName: networkSites.name,
      defaultConnectorType: otb.defaultConnectorType,
      defaultPolish: otb.defaultPolish,
      latitude: otb.latitude,
      longitude: otb.longitude,
      status: otb.status,
      // `distinct` WAJIB pada ketiganya: baris hasil adalah perkalian
      // silang tray × port, jadi `count(port)` polos akan mengalikan jumlah
      // port dengan jumlah tray. OTB 2 tray berisi 48 port terbaca 96.
      trayCount: sql<number>`count(distinct ${otbTrays.id})::int`,
      portCount: sql<number>`count(distinct ${otbPorts.id})::int`,
      usedPorts: sql<number>`count(distinct ${otbPorts.id}) filter (where ${otbPorts.status} = 'terpakai')::int`,
      brokenPorts: sql<number>`count(distinct ${otbPorts.id}) filter (where ${otbPorts.status} = 'rusak')::int`,
    })
    .from(otb)
    .leftJoin(networkSites, eq(networkSites.id, otb.siteId))
    .leftJoin(otbTrays, eq(otbTrays.otbId, otb.id))
    .leftJoin(otbPorts, eq(otbPorts.otbId, otb.id))
    .groupBy(otb.id, networkSites.name)
    .orderBy(asc(otb.code));
  return rows;
}

export async function detailOtb(otbId: string) {
  const [induk] = await db
    .select({
      id: otb.id,
      code: otb.code,
      name: otb.name,
      siteId: otb.siteId,
      siteName: networkSites.name,
      defaultConnectorType: otb.defaultConnectorType,
      defaultPolish: otb.defaultPolish,
      latitude: otb.latitude,
      longitude: otb.longitude,
      status: otb.status,
      notes: otb.notes,
      createdAt: otb.createdAt,
      updatedAt: otb.updatedAt,
    })
    .from(otb)
    .leftJoin(networkSites, eq(networkSites.id, otb.siteId))
    .where(eq(otb.id, otbId))
    .limit(1);
  if (!induk) return null;

  const baris = await db
    .select({
      id: otbTrays.id,
      trayNumber: otbTrays.trayNumber,
      connectorType: otbTrays.connectorType,
      polish: otbTrays.polish,
      label: otbTrays.label,
      trayStatus: otbTrays.status,
      portCount: sql<number>`count(${otbPorts.id})::int`,
      usedPorts: sql<number>`count(${otbPorts.id}) filter (where ${otbPorts.status} = 'terpakai')::int`,
      brokenPorts: sql<number>`count(${otbPorts.id}) filter (where ${otbPorts.status} = 'rusak')::int`,
    })
    .from(otbTrays)
    .leftJoin(otbPorts, eq(otbPorts.trayId, otbTrays.id))
    .where(eq(otbTrays.otbId, otbId))
    .groupBy(otbTrays.id)
    .orderBy(asc(otbTrays.trayNumber));

  const trays = baris.map((t) => ({
    id: t.id,
    trayNumber: t.trayNumber,
    connectorType: t.connectorType,
    polish: t.polish,
    label: t.label,
    portCount: t.portCount,
    usedPorts: t.usedPorts,
    brokenPorts: t.brokenPorts,
    status: statusTray(t.trayStatus === "aktif", t.portCount, t.usedPorts),
  }));

  return { ...induk, trays };
}

export async function daftarPortTray(otbId: string, trayNumber: number) {
  const [tray] = await db
    .select({ id: otbTrays.id })
    .from(otbTrays)
    .where(and(eq(otbTrays.otbId, otbId), eq(otbTrays.trayNumber, trayNumber)))
    .limit(1);
  if (!tray) return null;

  return db
    .select({
      id: otbPorts.id,
      portNumberInTray: otbPorts.portNumberInTray,
      globalPortNumber: otbPorts.globalPortNumber,
      status: otbPorts.status,
      externalServiceId: otbPorts.externalServiceId,
      notes: otbPorts.notes,
      updatedAt: otbPorts.updatedAt,
    })
    .from(otbPorts)
    .where(eq(otbPorts.trayId, tray.id))
    .orderBy(asc(otbPorts.portNumberInTray));
}

// ---------------------------------------------------------------------------
// Tulis
// ---------------------------------------------------------------------------

export interface BuatOtbInput {
  code: string;
  name: string;
  siteId?: string | null;
  connectorType?: TipeKonektor;
  polish?: Polish;
  trayCount: number;
  portsPerTray?: number;
  latitude?: number | null;
  longitude?: number | null;
  notes?: string | null;
}

/**
 * Membuat OTB beserta seluruh tray dan port-nya dalam SATU transaksi.
 *
 * Satu transaksi, bukan tiga insert berurutan: `POST /api/v1/ftth/odps` yang
 * ada lebih dulu membuat ODP lalu port-nya di luar transaksi, dan kalau insert
 * port gagal, ODP tanpa port tertinggal di database tanpa ada yang tahu.
 * Jangan menyalin cacat itu ke sini.
 */
export async function buatOtb(
  input: BuatOtbInput,
  actorUserId: string | null,
): Promise<HasilOtb<{ id: string; code: string; trayCount: number; portCount: number }>> {
  const code = input.code?.trim().toUpperCase();
  const name = input.name?.trim();
  if (!code || !name) {
    return { ok: false, status: 400, error: "code dan name wajib diisi." };
  }

  const connectorType = input.connectorType ?? "LC";
  const polish = input.polish ?? "APC";
  const portsPerTray = input.portsPerTray ?? KAPASITAS_BAWAAN[connectorType];

  if (!Number.isInteger(input.trayCount) || input.trayCount < 1 || input.trayCount > MAKS_TRAY) {
    return { ok: false, status: 400, error: `trayCount harus 1–${MAKS_TRAY}.` };
  }
  if (!Number.isInteger(portsPerTray) || portsPerTray < 1 || portsPerTray > MAKS_PORT_PER_TRAY) {
    return { ok: false, status: 400, error: `portsPerTray harus 1–${MAKS_PORT_PER_TRAY}.` };
  }

  const punyaKoordinat =
    typeof input.latitude === "number" && typeof input.longitude === "number";
  if (!input.siteId && !punyaKoordinat) {
    return {
      ok: false,
      status: 400,
      error: "OTB tanpa situs wajib punya latitude dan longitude, kalau tidak ia tidak akan pernah muncul di peta.",
    };
  }

  const [bentrok] = await db
    .select({ id: otb.id })
    .from(otb)
    .where(eq(otb.code, code))
    .limit(1);
  if (bentrok) {
    return { ok: false, status: 409, error: `Kode OTB ${code} sudah dipakai.` };
  }

  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(otb).values({
      id,
      code,
      name,
      siteId: input.siteId ?? null,
      defaultConnectorType: connectorType,
      defaultPolish: polish,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      notes: input.notes ?? null,
    });

    let global = 0;
    for (let nomorTray = 1; nomorTray <= input.trayCount; nomorTray += 1) {
      const trayId = randomUUID();
      await tx.insert(otbTrays).values({
        id: trayId,
        otbId: id,
        trayNumber: nomorTray,
        connectorType,
        polish,
      });
      await tx.insert(otbPorts).values(
        Array.from({ length: portsPerTray }, (_, i) => ({
          id: randomUUID(),
          trayId,
          otbId: id,
          portNumberInTray: i + 1,
          globalPortNumber: ++global,
          status: "kosong" as const,
        })),
      );
    }

    await writeAudit(tx as unknown as typeof db, "otb.created", "otb", id, actorUserId, {
      code,
      trayCount: input.trayCount,
      portsPerTray,
      connectorType,
      polish,
    });
  });

  return {
    ok: true,
    data: { id, code, trayCount: input.trayCount, portCount: input.trayCount * portsPerTray },
  };
}

export interface UbahPortInput {
  status?: StatusPortOtb;
  externalServiceId?: string | null;
  notes?: string | null;
}

export async function ubahPort(
  otbId: string,
  trayNumber: number,
  portNumberInTray: number,
  patch: UbahPortInput,
  actorUserId: string | null,
): Promise<HasilOtb<{ id: string; portNumberInTray: number; status: StatusPortOtb }>> {
  if (patch.status !== undefined && !statusPortSah(patch.status)) {
    return {
      ok: false,
      status: 400,
      error: `status harus salah satu dari: ${STATUS_PORT_OTB.join(", ")}.`,
    };
  }

  const [induk] = await db
    .select({ code: otb.code, status: otb.status })
    .from(otb)
    .where(eq(otb.id, otbId))
    .limit(1);
  if (!induk) {
    return { ok: false, status: 404, error: "OTB tidak ditemukan." };
  }
  if (induk.status !== "aktif") {
    return {
      ok: false,
      status: 409,
      error: `OTB ${induk.code} nonaktif — aktifkan dulu sebelum mengubah portnya.`,
    };
  }

  const [tray] = await db
    .select({ id: otbTrays.id })
    .from(otbTrays)
    .where(and(eq(otbTrays.otbId, otbId), eq(otbTrays.trayNumber, trayNumber)))
    .limit(1);
  if (!tray) {
    return { ok: false, status: 404, error: "Tray tidak ditemukan pada OTB ini." };
  }

  const [sebelum] = await db
    .select({
      id: otbPorts.id,
      status: otbPorts.status,
      externalServiceId: otbPorts.externalServiceId,
      notes: otbPorts.notes,
    })
    .from(otbPorts)
    .where(
      and(
        eq(otbPorts.trayId, tray.id),
        eq(otbPorts.portNumberInTray, portNumberInTray),
      ),
    )
    .limit(1);
  if (!sebelum) {
    return { ok: false, status: 404, error: "Port tidak ditemukan pada tray ini." };
  }

  const perubahan: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.status !== undefined) perubahan.status = patch.status;
  if (patch.externalServiceId !== undefined) {
    perubahan.externalServiceId = patch.externalServiceId;
  }
  if (patch.notes !== undefined) perubahan.notes = patch.notes;

  let hasil!: { id: string; portNumberInTray: number; status: StatusPortOtb };
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(otbPorts)
      .set(perubahan)
      .where(eq(otbPorts.id, sebelum.id))
      .returning({
        id: otbPorts.id,
        portNumberInTray: otbPorts.portNumberInTray,
        status: otbPorts.status,
      });
    // Sebelum/sesudah, supaya audit bisa menjawab "apa yang berubah", bukan
    // sekadar "ada yang menyentuhnya".
    await writeAudit(
      tx as unknown as typeof db,
      "otb.port.updated",
      "otb_port",
      sebelum.id,
      actorUserId,
      {
        otbId,
        trayNumber,
        portNumberInTray,
        sebelum: {
          status: sebelum.status,
          externalServiceId: sebelum.externalServiceId,
          notes: sebelum.notes,
        },
        sesudah: patch,
      },
    );
    hasil = row as typeof hasil;
  });

  return { ok: true, data: hasil };
}

/**
 * Mengubah jumlah port sebuah tray (PRD FR-OTB-003).
 *
 * **Menambah** port tidak pernah menyentuh port lama. Nomor global port baru
 * melanjutkan nomor TERBESAR di seluruh OTB, bukan disisipkan setelah port
 * terakhir tray ini — kalau disisipkan, nomor global seluruh tray sesudahnya
 * bergeser, dan setiap label yang sudah tertempel di lapangan seketika
 * menunjuk port yang salah.
 *
 * **Mengurangi** ditolak kalau ada port yang akan hilang dan port itu tidak
 * berstatus `kosong`, ATAU pernah punya jejak di `audit_logs`. Port dibuat
 * tanpa baris audit sendiri, jadi adanya baris audit berarti seseorang pernah
 * mengubahnya — dan riwayat sebuah port fisik tidak boleh lenyap karena
 * seseorang salah ketik angka kapasitas.
 *
 * Aturan ini tetap benar setelah core masuk di fase berikutnya: core yang
 * terpasang membuat port tidak lagi `kosong`, jadi ia otomatis ikut terlindungi
 * tanpa aturan ini perlu ditulis ulang.
 */
export async function aturKapasitasTray(
  otbId: string,
  trayNumber: number,
  portCountBaru: number,
  actorUserId: string | null,
): Promise<HasilOtb<{ trayId: string; portCount: number }>> {
  if (
    !Number.isInteger(portCountBaru) ||
    portCountBaru < 1 ||
    portCountBaru > MAKS_PORT_PER_TRAY
  ) {
    return { ok: false, status: 400, error: `portCount harus 1–${MAKS_PORT_PER_TRAY}.` };
  }

  const [tray] = await db
    .select({ id: otbTrays.id })
    .from(otbTrays)
    .where(and(eq(otbTrays.otbId, otbId), eq(otbTrays.trayNumber, trayNumber)))
    .limit(1);
  if (!tray) {
    return { ok: false, status: 404, error: "Tray tidak ditemukan pada OTB ini." };
  }

  const portSekarang = await db
    .select({
      id: otbPorts.id,
      portNumberInTray: otbPorts.portNumberInTray,
      status: otbPorts.status,
      externalServiceId: otbPorts.externalServiceId,
    })
    .from(otbPorts)
    .where(eq(otbPorts.trayId, tray.id))
    .orderBy(asc(otbPorts.portNumberInTray));

  const jumlahSekarang = portSekarang.length;
  if (portCountBaru === jumlahSekarang) {
    return { ok: true, data: { trayId: tray.id, portCount: jumlahSekarang } };
  }

  if (portCountBaru < jumlahSekarang) {
    const akanHilang = portSekarang.filter(
      (p) => p.portNumberInTray > portCountBaru,
    );
    // Bukan cuma `status`: port `kosong` yang masih memegang
    // `external_service_id` adalah port yang belum benar-benar dilepas.
    const terpakai = akanHilang.filter(
      (p) => p.status !== "kosong" || p.externalServiceId !== null,
    );
    if (terpakai.length > 0) {
      const nomor = terpakai.map((p) => p.portNumberInTray).join(", ");
      return {
        ok: false,
        status: 409,
        error: `Kapasitas tidak bisa diturunkan: port ${nomor} masih dipakai, dicadangkan, rusak, atau belum dilepas dari layanannya.`,
      };
    }

    const berjejak = await db
      .select({ entityId: auditLogs.entityId })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, "otb_port"),
          inArray(
            auditLogs.entityId,
            akanHilang.map((p) => p.id),
          ),
        ),
      );
    if (berjejak.length > 0) {
      const idBerjejak = new Set(berjejak.map((b) => b.entityId));
      const nomor = akanHilang
        .filter((p) => idBerjejak.has(p.id))
        .map((p) => p.portNumberInTray)
        .join(", ");
      return {
        ok: false,
        status: 409,
        error: `Kapasitas tidak bisa diturunkan: port ${nomor} punya riwayat perubahan.`,
      };
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(otbPorts)
        .where(
          and(
            eq(otbPorts.trayId, tray.id),
            gt(otbPorts.portNumberInTray, portCountBaru),
          ),
        );
      await writeAudit(
        tx as unknown as typeof db,
        "otb.tray.capacity_changed",
        "otb_tray",
        tray.id,
        actorUserId,
        { otbId, trayNumber, dari: jumlahSekarang, ke: portCountBaru },
      );
    });
    return { ok: true, data: { trayId: tray.id, portCount: portCountBaru } };
  }

  const [{ maksGlobal }] = await db
    .select({
      maksGlobal: sql<number>`coalesce(max(${otbPorts.globalPortNumber}), 0)::int`,
    })
    .from(otbPorts)
    .where(eq(otbPorts.otbId, otbId));

  await db.transaction(async (tx) => {
    await tx.insert(otbPorts).values(
      Array.from({ length: portCountBaru - jumlahSekarang }, (_, i) => ({
        id: randomUUID(),
        trayId: tray.id,
        otbId,
        portNumberInTray: jumlahSekarang + i + 1,
        globalPortNumber: maksGlobal + i + 1,
        status: "kosong" as const,
      })),
    );
    await writeAudit(
      tx as unknown as typeof db,
      "otb.tray.capacity_changed",
      "otb_tray",
      tray.id,
      actorUserId,
      { otbId, trayNumber, dari: jumlahSekarang, ke: portCountBaru },
    );
  });

  return { ok: true, data: { trayId: tray.id, portCount: portCountBaru } };
}
