import { NextResponse } from "next/server";
import type { LibrenmsAlertIngestResponse } from "@/server/api-v1/contracts";
import { applyLibrenmsAlert } from "@/server/incident-store";
import { parseLibrenmsAlert } from "@/server/librenms/alert";
import { dispatchAlert } from "@/server/notifier";

export const dynamic = "force-dynamic";

/**
 * Rate limit sederhana per IP (in-memory, per proses). Produksi multi-instance
 * memakai Redis (lapisan cache.ts) — catatan PRD Fase 4.
 */
const WINDOW_MS = 10_000;
const MAX_PER_WINDOW = 10;
const attempts = new Map<string, { count: number; windowStart: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    attempts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

/**
 * POST /api/v1/integrations/librenms/alerts
 * Webhook ingress alert/recovery dari LibreNMS (API transport).
 *
 * Keamanan: bila LIBRENMS_WEBHOOK_SECRET di-set, permintaan wajib membawa
 * header `x-webhook-token` bernilai sama. Alert diproses idempoten ke tabel
 * incidents (anti incident ganda) lalu didispatch ke channel notifikasi.
 */
export async function POST(request: Request) {
  const secret = process.env.LIBRENMS_WEBHOOK_SECRET;
  if (secret && request.headers.get("x-webhook-token") !== secret) {
    return NextResponse.json(
      { error: "Token webhook tidak valid." },
      { status: 401 },
    );
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "Terlalu banyak permintaan webhook." },
      { status: 429 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body harus JSON yang valid." },
      { status: 400 },
    );
  }

  const parsed = parseLibrenmsAlert(raw);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const incident = await applyLibrenmsAlert(parsed);

  const result = await dispatchAlert({
    librenmsAlertId: parsed.librenmsAlertId,
    deviceName: parsed.deviceName,
    message:
      parsed.state === "recovered"
        ? `✅ PULIH: ${parsed.message}`
        : parsed.message,
  });

  const body: LibrenmsAlertIngestResponse = {
    ok: true,
    librenmsAlertId: parsed.librenmsAlertId,
    state: parsed.state,
    sent: result.sent,
    failed: result.failed,
    incidentId: incident.incidentId,
  };
  return NextResponse.json(body, { status: 202 });
}
