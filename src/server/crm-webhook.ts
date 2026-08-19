// Webhook OUTBOUND ke CRM eksternal (Fase 6) — notifikasi incident/recovery.
//
// Kontrak (documented contract; tidak ada CRM nyata yang dipanggil tanpa
// endpoint + secret + persetujuan):
//   POST <CRM_WEBHOOK_URL>
//   Authorization: Bearer <CRM_WEBHOOK_TOKEN>   (bila di-set)
//   {
//     "idempotencyKey": "<incidentId>:<open|recovered>",
//     "type": "incident.open" | "incident.recovered",
//     "externalCustomerId": "...", "externalServiceId": "...",
//     "severity": "...", "message": "...", "occurredAt": "..."
//   }
//
// Sifat: best-effort. Tanpa CRM_WEBHOOK_URL → tidak dikirim (bukan error).
// Retry 2× (total 3 percobaan) dengan jeda; idempotency key untuk mencegah
// duplikasi di sisi penerima; kegagalan tidak pernah menggagalkan alur utama
// webhook ingress (dilog & dicatat di audit log).

import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { auditLogs, crmServiceMappings } from "@/db/schema";
import { sanitizeForCustomer } from "@/server/customer-store";
import {
  isOutwardBlocked,
  outwardFetch,
  recordOutwardBlocked,
} from "@/server/outward-guard";

interface IncidentForCrm {
  id: string;
  assetId: string | null;
  deviceName: string;
  severity: "ok" | "warning" | "critical";
  message: string;
  triggeredAt: Date;
  recoveredAt: Date | null;
}

const RETRY_DELAYS_MS = [500, 1500];

async function writeAudit(
  incidentId: string,
  ok: boolean,
  detail: Record<string, unknown>,
) {
  await db.insert(auditLogs).values({
    id: randomUUID(),
    actorUserId: null,
    actorLabel: "system:crm-webhook",
    action: ok ? "crm_webhook.sent" : "crm_webhook.failed",
    entityType: "incident",
    entityId: incidentId,
    detail,
    createdAt: new Date(),
  });
}

/** Kirim notifikasi ke CRM bila dikonfigurasi; never throws. */
export async function notifyCrm(
  incident: IncidentForCrm,
  action: "open" | "recovered",
): Promise<{ sent: boolean; reason?: string }> {
  const url = process.env.CRM_WEBHOOK_URL?.trim();
  if (!url) return { sent: false, reason: "not-configured" };

  // Mode baca-saja. Diperiksa SESUDAH cek URL: kalau CRM_WEBHOOK_URL belum
  // diisi, tidak ada niat mengirim apa pun dan tidak ada yang perlu dicatat.
  // Begitu URL-nya ada, penahanan ini adalah keputusan yang layak berjejak.
  if (isOutwardBlocked()) {
    await recordOutwardBlocked(
      "crm-webhook",
      { type: "incident", id: incident.id },
      { intendedType: action === "open" ? "incident.open" : "incident.recovered" },
    );
    return { sent: false, reason: "read-only-mode" };
  }

  if (!incident.assetId) return { sent: false, reason: "no-asset-mapping" };

  const [mapping] = await db
    .select()
    .from(crmServiceMappings)
    .where(and(eq(crmServiceMappings.assetId, incident.assetId)))
    .limit(1);
  if (!mapping) return { sent: false, reason: "no-crm-mapping" };

  const token = process.env.CRM_WEBHOOK_TOKEN?.trim();
  const body = {
    idempotencyKey: `${incident.id}:${action}`,
    type: action === "open" ? "incident.open" : "incident.recovered",
    externalCustomerId: mapping.externalCustomerId,
    externalServiceId: mapping.externalServiceId,
    severity: incident.severity,
    message: sanitizeForCustomer(incident.message, incident.deviceName),
    occurredAt: (action === "recovered" ? incident.recoveredAt : incident.triggeredAt)?.toISOString() ?? new Date().toISOString(),
  };

  let lastError = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await outwardFetch("crm-webhook", url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        await writeAudit(incident.id, true, { action: body.type, url });
        return { sent: true };
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < RETRY_DELAYS_MS.length) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }

  console.error(
    `[crm-webhook] gagal mengirim ${body.type} untuk incident ${incident.id}: ${lastError}`,
  );
  await writeAudit(incident.id, false, { action: body.type, error: lastError });
  return { sent: false, reason: lastError };
}
