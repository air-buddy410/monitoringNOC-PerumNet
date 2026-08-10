// Portal customer (Fase 6) — status layanan publik dengan ISOLASI ketat.
//
// Aturan isolasi sesuai PRD:
// - Customer hanya melihat layanan miliknya sendiri: akses lewat deep link
//   (customerId + token HMAC berbasis CUSTOMER_PORTAL_SECRET), bukan sesi.
// - Response TIDAK pernah memuat IP manajemen, hostname internal, topologi,
//   vendor/model, atau raw grafik — pesan incident di-sanitasi.
// - Bila pemetaan layanan tidak ada → 404 (tidak membocorkan keberadaan).

import { createHmac, timingSafeEqual } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { incidents } from "@/db/schema";
import type { CustomerServiceStatusResponse } from "@/server/api-v1/contracts";
import { findServiceMapping } from "@/server/crm-store";
import { getAssetsWithStatus } from "@/server/device-store";

/** Deep-link token layanan: HMAC(customerId|serviceId) — deterministik, tanpa
 * penyimpanan; dipakai CRM/email sebagai link aman ke halaman status. */
export function customerDeepLinkToken(
  customerId: string,
  serviceId: string,
): string {
  return createHmac("sha256", process.env.CUSTOMER_PORTAL_SECRET ?? "")
    .update(`${customerId}|${serviceId}`)
    .digest("hex");
}

/** Verifikasi token dengan perbandingan waktu konstan. */
export function verifyCustomerDeepLink(
  customerId: string,
  serviceId: string,
  token: string,
): boolean {
  const secret = process.env.CUSTOMER_PORTAL_SECRET;
  if (!secret || !token) return false;
  const expected = customerDeepLinkToken(customerId, serviceId);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(token, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Sanitasi pesan internal untuk publik: hilangkan nama perangkat internal
 * dan terminologi teknis yang terlalu spesifik — cukup ringkasan gangguan.
 */
export function sanitizeForCustomer(
  message: string,
  deviceName: string | null,
): string {
  let text = message.trim();
  if (deviceName) {
    text = text.split(deviceName).join("Layanan terkait");
  }
  if (text === "" ) return "Gangguan layanan terdeteksi.";
  return text;
}

export type CustomerStatusResult =
  | { ok: true; status: CustomerServiceStatusResponse }
  | { ok: false; status: 400 | 401 | 404; error: string };

interface IncidentRow {
  id: string;
  assetId: string | null;
  deviceName: string;
  severity: "ok" | "warning" | "critical";
  state: "open" | "acknowledged" | "resolved";
  message: string;
  triggeredAt: Date;
  recoveredAt: Date | null;
}

export async function getCustomerServiceStatus(input: {
  customerId: string;
  serviceId: string;
  token: string;
}): Promise<CustomerStatusResult> {
  if (!input.customerId.trim() || !input.serviceId.trim() || !input.token.trim()) {
    return {
      ok: false,
      status: 400,
      error: "customerId, serviceId, dan token wajib diisi.",
    };
  }
  if (!verifyCustomerDeepLink(input.customerId, input.serviceId, input.token)) {
    return { ok: false, status: 401, error: "Tautan tidak valid atau kedaluwarsa." };
  }

  const mapping = await findServiceMapping(
    input.customerId.trim(),
    input.serviceId.trim(),
  );
  if (!mapping || !mapping.assetId) {
    // Tidak membeberkan apakah mapping ada — cukup "tidak ditemukan".
    return { ok: false, status: 404, error: "Layanan tidak ditemukan." };
  }

  const { assets } = await getAssetsWithStatus();
  const asset = assets.find((item) => item.assetId === mapping.assetId);

  const rows = await db
    .select()
    .from(incidents)
    .where(eq(incidents.assetId, mapping.assetId))
    .orderBy(desc(incidents.triggeredAt))
    .limit(20);
  const incidentRows = rows as unknown as IncidentRow[];

  const active = incidentRows.find((row) => row.state !== "resolved") ?? null;
  const resolved = incidentRows.filter((row) => row.state === "resolved");

  let status: CustomerServiceStatusResponse["status"] = "up";
  if (asset?.status === "offline") {
    status = "down";
  } else if (asset?.status === "warning" || active) {
    status = "degraded";
  }

  const history = resolved.slice(0, 10).map((row) => {
    const start = row.triggeredAt.getTime();
    const end = row.recoveredAt?.getTime() ?? Date.now();
    return {
      occurredAt: row.triggeredAt.toISOString(),
      durationMinutes: Math.max(1, Math.round((end - start) / 60_000)),
      summary: sanitizeForCustomer(row.message, row.deviceName),
    };
  });

  const body: CustomerServiceStatusResponse = {
    serviceId: input.serviceId.trim(),
    status,
    activeIncident: active
      ? {
          startedAt: active.triggeredAt.toISOString(),
          message: sanitizeForCustomer(active.message, active.deviceName),
        }
      : null,
    history,
    supportContact:
      process.env.CUSTOMER_SUPPORT_CONTACT?.trim() || "021-XXXX-XXXX",
  };
  return { ok: true, status: body };
}
