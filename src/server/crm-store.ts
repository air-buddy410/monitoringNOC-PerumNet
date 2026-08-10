// Mapping layanan CRM eksternal (Fase 6) — Portal hanya menyimpan mapping
// minimal: external customerId, external serviceId, assetId/group LibreNMS,
// status sinkronisasi, dan audit. CRM tidak dibangun/dimutasi dari sini.
//
// Idempoten: satu baris per (externalCustomerId, externalServiceId) lewat
// unique index `crm_service_mappings_service_idx`; upsert tidak menduplikasi.

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets as assetsTable, auditLogs, crmServiceMappings } from "@/db/schema";
import type { CrmServiceMapping } from "@/server/api-v1/contracts";

type MappingRow = typeof crmServiceMappings.$inferSelect;

function toMapping(row: MappingRow): CrmServiceMapping {
  return {
    mappingId: row.id,
    externalCustomerId: row.externalCustomerId,
    externalServiceId: row.externalServiceId,
    assetId: row.assetId,
    librenmsGroup: row.librenmsGroup,
    syncStatus: row.syncStatus,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function writeAudit(
  action: string,
  mappingId: string,
  actorUserId: string,
  detail?: Record<string, unknown>,
) {
  await db.insert(auditLogs).values({
    id: randomUUID(),
    actorUserId,
    actorLabel: "user",
    action,
    entityType: "crm_service_mapping",
    entityId: mappingId,
    detail,
    createdAt: new Date(),
  });
}

/** Validasi assetId: harus dikenal Portal dan terpetakan (opsional). */
export async function assetExists(assetId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: assetsTable.assetId })
    .from(assetsTable)
    .where(eq(assetsTable.assetId, assetId))
    .limit(1);
  return Boolean(row);
}

export type UpsertMappingResult =
  | { ok: true; mapping: CrmServiceMapping; created: boolean }
  | { ok: false; error: string };

/**
 * Buat/perbarui mapping layanan (idempoten). Bila assetId diberikan dan
 * librenmsGroup tidak, status sinkronisasi ditandai aktif; kombinasi dengan
 * group memakai group (assetId dapat tetap menjadi penunjuk utama).
 */
export async function upsertServiceMapping(input: {
  externalCustomerId: string;
  externalServiceId: string;
  assetId?: string;
  librenmsGroup?: string;
  actorUserId: string;
}): Promise<UpsertMappingResult> {
  const customerId = input.externalCustomerId.trim();
  const serviceId = input.externalServiceId.trim();
  if (!customerId || !serviceId) {
    return { ok: false, error: "externalCustomerId dan externalServiceId wajib diisi." };
  }
  if (customerId.length > 120 || serviceId.length > 120) {
    return { ok: false, error: "ID customer/service maksimal 120 karakter." };
  }

  const assetId = input.assetId?.trim() || null;
  if (assetId && !(await assetExists(assetId))) {
    return { ok: false, error: `Aset tidak dikenal: ${assetId}` };
  }
  const librenmsGroup = input.librenmsGroup?.trim() || null;

  const [existing] = await db
    .select()
    .from(crmServiceMappings)
    .where(
      and(
        eq(crmServiceMappings.externalCustomerId, customerId),
        eq(crmServiceMappings.externalServiceId, serviceId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(crmServiceMappings)
      .set({
        assetId: assetId ?? existing.assetId,
        librenmsGroup: librenmsGroup ?? existing.librenmsGroup,
        syncStatus: librenmsGroup ? "pending" : "active",
        updatedAt: new Date(),
      })
      .where(eq(crmServiceMappings.id, existing.id));
    await writeAudit("crm_mapping.updated", existing.id, input.actorUserId, {
      externalCustomerId: customerId,
      externalServiceId: serviceId,
    });
    const [row] = await db
      .select()
      .from(crmServiceMappings)
      .where(eq(crmServiceMappings.id, existing.id))
      .limit(1);
    return { ok: true, mapping: toMapping(row), created: false };
  }

  const id = randomUUID();
  await db.insert(crmServiceMappings).values({
    id,
    externalCustomerId: customerId,
    externalServiceId: serviceId,
    assetId,
    librenmsGroup,
    syncStatus: librenmsGroup ? "pending" : "active",
  });
  await writeAudit("crm_mapping.created", id, input.actorUserId, {
    externalCustomerId: customerId,
    externalServiceId: serviceId,
  });
  const [row] = await db
    .select()
    .from(crmServiceMappings)
    .where(eq(crmServiceMappings.id, id))
    .limit(1);
  return { ok: true, mapping: toMapping(row), created: true };
}

export async function listServiceMappings(): Promise<CrmServiceMapping[]> {
  const rows = await db
    .select()
    .from(crmServiceMappings)
    .orderBy(desc(crmServiceMappings.updatedAt));
  return rows.map(toMapping);
}

/** Mapping per (customer, service) untuk konsumsi portal customer/webhook. */
export async function findServiceMapping(
  externalCustomerId: string,
  externalServiceId: string,
): Promise<MappingRow | null> {
  const [row] = await db
    .select()
    .from(crmServiceMappings)
    .where(
      and(
        eq(crmServiceMappings.externalCustomerId, externalCustomerId),
        eq(crmServiceMappings.externalServiceId, externalServiceId),
      ),
    )
    .limit(1);
  return row ?? null;
}
