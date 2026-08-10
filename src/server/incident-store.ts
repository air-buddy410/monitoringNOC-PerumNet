// Model incident Fase 4: upsert idempoten dari webhook alert LibreNMS.
//
// Idempotensi (PRD: "alert dan recovery harus idempoten agar alert yang sama
// tidak membuat incident ganda"):
// - partial unique index `incidents_active_alert_idx` (schema.ts) menjamin
//   satu incident aktif per librenmsAlertId; alert berulang memutakhirkan
//   baris yang sama.
// - recovery menutup (resolve) incident aktif; recovery tanpa incident aktif
//   diabaikan (tidak membuat baris baru).
// Setiap buat/tutup dictatat ke audit_logs (aktor sistem, tanpa user).

import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { assets as assetsTable, auditLogs, incidents } from "@/db/schema";
import type { NormalizedLibrenmsAlert } from "@/server/librenms/alert";

export interface IncidentUpsertResult {
  incidentId: string;
  state: "open" | "acknowledged" | "resolved";
  created: boolean;
  updated: boolean;
}

function parseTimestamp(raw: string | null): Date {
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date : new Date();
}

/** Resolve assetId dari librenmsDeviceId (best effort; null bila tak dikenal). */
async function resolveAssetId(librenmsDeviceId: number | null): Promise<string | null> {
  if (librenmsDeviceId === null) return null;
  const rows = await db
    .select({ assetId: assetsTable.assetId })
    .from(assetsTable)
    .where(eq(assetsTable.librenmsDeviceId, librenmsDeviceId))
    .limit(1);
  return rows[0]?.assetId ?? null;
}

async function findActiveIncident(librenmsAlertId: string) {
  const rows = await db
    .select()
    .from(incidents)
    .where(
      and(
        eq(incidents.librenmsAlertId, librenmsAlertId),
        ne(incidents.state, "resolved"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Rekam audit trail ringkas untuk aksi sistem webhook. */
async function writeAudit(action: string, entityId: string, detail: Record<string, unknown>) {
  await db.insert(auditLogs).values({
    id: randomUUID(),
    actorUserId: null,
    actorLabel: "system:librenms-webhook",
    action,
    entityType: "incident",
    entityId,
    detail,
    createdAt: new Date(),
  });
}

/**
 * Terapkan satu alert/recovery LibreNMS ke tabel incident (idempoten).
 * Alert firing → open/update; recovery → resolve incident aktif.
 */
export async function applyLibrenmsAlert(
  parsed: NormalizedLibrenmsAlert,
): Promise<IncidentUpsertResult> {
  const triggeredAt = parseTimestamp(parsed.timestamp);

  if (parsed.state === "recovered") {
    const active = await findActiveIncident(parsed.librenmsAlertId);
    if (!active) {
      // Recovery tanpa incident aktif: diabaikan dengan sengaja (idempoten).
      return {
        incidentId: "",
        state: "resolved",
        created: false,
        updated: false,
      };
    }
    await db
      .update(incidents)
      .set({ state: "resolved", recoveredAt: new Date(), updatedAt: new Date() })
      .where(eq(incidents.id, active.id));
    await writeAudit("incident.resolved", active.id, {
      librenmsAlertId: parsed.librenmsAlertId,
      deviceName: parsed.deviceName,
    });
    return {
      incidentId: active.id,
      state: "resolved",
      created: false,
      updated: true,
    };
  }

  const assetId = await resolveAssetId(parsed.librenmsDeviceId);
  const active = await findActiveIncident(parsed.librenmsAlertId);

  if (active) {
    // Alert berulang / perubahan severity → perbarui baris aktif yang sama.
    await db
      .update(incidents)
      .set({
        severity: parsed.severity,
        message: parsed.message,
        deviceName: parsed.deviceName,
        assetId: assetId ?? active.assetId,
        triggeredAt,
        updatedAt: new Date(),
      })
      .where(eq(incidents.id, active.id));
    return {
      incidentId: active.id,
      state: active.state,
      created: false,
      updated: true,
    };
  }

  // Insert baru; partial unique index menangkal duplikat bila dua webhook
  // bersamaan — batal dan ambil baris yang sudah terlanjur ada.
  const id = randomUUID();
  try {
    await db.insert(incidents).values({
      id,
      librenmsAlertId: parsed.librenmsAlertId,
      assetId,
      deviceName: parsed.deviceName,
      severity: parsed.severity,
      state: "open",
      message: parsed.message,
      triggeredAt,
    });
  } catch {
    const raced = await findActiveIncident(parsed.librenmsAlertId);
    if (!raced) throw new Error("Gagal menyimpan incident dan tidak ditemukan baris aktif.");
    await writeAudit("incident.created", raced.id, {
      librenmsAlertId: parsed.librenmsAlertId,
      deviceName: parsed.deviceName,
    });
    return {
      incidentId: raced.id,
      state: raced.state,
      created: false,
      updated: false,
    };
  }

  await writeAudit("incident.created", id, {
    librenmsAlertId: parsed.librenmsAlertId,
    deviceName: parsed.deviceName,
    severity: parsed.severity,
  });
  return { incidentId: id, state: "open", created: true, updated: false };
}
