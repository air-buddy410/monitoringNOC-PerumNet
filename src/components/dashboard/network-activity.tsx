"use client";

// Insiden aktif dari kontrak v1 (/api/v1/incidents) — prioritas penanganan
// tim NOC dengan tindakan acknowledge langsung (peran admin/noc/engineer).

import Link from "next/link";
import useSWR from "swr";
import { Check, ChevronRight } from "lucide-react";
import MiniMap from "@/components/dashboard/mini-map";
import { useSession } from "@/hooks/use-session";
import { getJson } from "@/lib/api/http";
import type { IncidentView, IncidentsResponse } from "@/server/api-v1/contracts";

const severityLabel: Record<IncidentView["severity"], string> = {
  critical: "Kritis",
  warning: "Perhatian",
  ok: "Pulih",
};

export default function NetworkActivity() {
  const { session } = useSession();
  const role = session?.user.role;
  const canAcknowledge = role === "admin" || role === "noc" || role === "engineer";

  const { data, mutate } = useSWR<IncidentsResponse>(
    "/api/v1/incidents?limit=50",
    getJson,
    { refreshInterval: 10_000, refreshWhenHidden: true, revalidateOnFocus: false },
  );

  const incidents = (data?.incidents ?? [])
    .filter((incident) => incident.state !== "resolved")
    .slice(0, 5);

  async function acknowledge(incident: IncidentView) {
    const response = await fetch(
      `/api/v1/incidents/${encodeURIComponent(incident.librenmsAlertId)}/acknowledge`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "Dikonfirmasi dari dasbor." }),
      },
    );
    if (response.ok) await mutate();
  }

  return (
    <>
      <div className="noc-command-grid">
        <MiniMap />
        <section className="noc-panel noc-incidents-panel">
          <div className="noc-panel-heading">
            <div>
              <h2>Insiden aktif</h2>
              <p>Prioritas penanganan tim NOC</p>
            </div>
            <Link href="/notifications">
              Lihat semua <ChevronRight />
            </Link>
          </div>
          <div className="noc-incident-list">
            {incidents.length === 0 ? (
              <div className="noc-empty-state">Tidak ada insiden aktif saat ini.</div>
            ) : (
              incidents.map((incident) => (
                <div className="noc-incident-row" key={incident.id}>
                  <span
                    className={`noc-severity-dot ${
                      incident.severity === "critical" ? "offline" : "warning"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <strong>{severityLabel[incident.severity]}</strong>
                    <span className="truncate">{incident.deviceName}</span>
                    <small className="truncate">
                      {incident.message} ·{" "}
                      {new Date(incident.triggeredAt).toLocaleTimeString("id-ID", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </small>
                  </div>
                  {canAcknowledge && incident.state === "open" && (
                    <button
                      type="button"
                      title="Acknowledge"
                      onClick={() => void acknowledge(incident)}
                      className="flex h-7 w-7 items-center justify-center rounded-md border text-xs text-emerald-600 hover:bg-emerald-50"
                    >
                      <Check aria-hidden="true" size={14} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </>
  );
}
