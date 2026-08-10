import { NextResponse } from "next/server";
import type { AcknowledgeResponse } from "@/server/api-v1/contracts";
import { acknowledgeIncident } from "@/server/incident-store";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

const MAX_NOTE_LENGTH = 500;

/**
 * POST /api/v1/incidents/:alertId/acknowledge
 * Acknowledge incident aktif dengan catatan resolusi (opsional). `:alertId`
 * menerima ID internal incident atau librenmsAlertId. Mencatat audit trail
 * (actor = user sesi). Incident yang sudah resolved ditolak (409).
 */
export const POST = withRole<{ params: Promise<{ alertId: string }> }>(
  ["admin", "noc", "engineer"],
  async (request, user, { params }) => {
    const { alertId } = await params;
    if (!alertId.trim()) {
      return NextResponse.json(
        { error: "alertId wajib diisi." },
        { status: 400 },
      );
    }

    let note: string | undefined;
    try {
      const raw = await request.json();
      if (raw && typeof raw.note === "string" && raw.note.trim() !== "") {
        note = raw.note.trim();
      }
    } catch {
      // Body opsional; tanpa body = ack tanpa catatan.
    }
    if (note && note.length > MAX_NOTE_LENGTH) {
      return NextResponse.json(
        { error: `note maksimal ${MAX_NOTE_LENGTH} karakter.` },
        { status: 400 },
      );
    }

    const result = await acknowledgeIncident({
      ref: alertId,
      acknowledgedBy: user.id,
      note,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const body: AcknowledgeResponse = { incident: result.incident };
    return NextResponse.json(body);
  },
);
