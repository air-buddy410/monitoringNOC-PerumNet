"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { BookOpen, ChevronRight, Clock3, Plus, RefreshCw, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError, getJson, sendJson } from "@/lib/api/http";
import { formatDateTime, formatAge } from "@/lib/noc-format";
import { NocPanel, NocState, NocStatus } from "@/components/noc-ui";
import { useSession } from "@/hooks/use-session";
import type { IncidentView, IncidentsResponse } from "@/server/api-v1/contracts";
import type { IncidentUpdate, IncidentUpdateKind, IncidentUpdatesResponse } from "@/types/operations";

const kindLabels: Record<IncidentUpdateKind, string> = {
  catatan: "Catatan",
  status: "Status",
  eskalasi: "Eskalasi",
  penyebab: "Penyebab",
  penutupan: "Penutupan",
};

function incidentTone(severity: string) {
  if (severity === "critical") return "danger" as const;
  if (severity === "warning") return "warning" as const;
  return "positive" as const;
}

function updateTone(kind: IncidentUpdateKind) {
  if (kind === "eskalasi" || kind === "penutupan") return "warning" as const;
  if (kind === "penyebab") return "info" as const;
  if (kind === "status") return "positive" as const;
  return "neutral" as const;
}

function IncidentListRow({ incident, selected, onSelect }: { incident: IncidentView; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={`noc-incident-select-row ${selected ? "is-selected" : ""}`} onClick={onSelect}>
      <span className={`noc-incident-severity-dot is-${incident.severity}`} aria-hidden="true" />
      <span className="noc-incident-select-copy"><strong>{incident.deviceName}</strong><small>{incident.message}</small><span>{formatAge(incident.triggeredAt)} · {incident.state === "resolved" ? "Selesai" : incident.state === "acknowledged" ? "Diakui" : "Terbuka"}</span></span>
      <ChevronRight aria-hidden="true" />
    </button>
  );
}

function IncidentTimeline({ updates }: { updates: IncidentUpdate[] }) {
  if (updates.length === 0) return <NocState kind="empty">Belum ada catatan riwayat untuk incident ini.</NocState>;
  return (
    <div className="noc-incident-timeline">
      {updates.map((update) => (
        <article key={update.id} className="noc-incident-timeline-item">
          <span className={`noc-timeline-marker is-${update.kind}`} aria-hidden="true" />
          <div className="noc-timeline-content">
            <div className="noc-timeline-meta"><NocStatus label={kindLabels[update.kind]} tone={updateTone(update.kind)} dot={false} /><span><Clock3 aria-hidden="true" /> {formatDateTime(update.createdAt)}</span></div>
            <p>{update.body}</p>
            <small><UserRound aria-hidden="true" /> {update.authorLabel || "Sistem"}</small>
          </div>
        </article>
      ))}
    </div>
  );
}

export default function IncidentHistoryPanel() {
  const { session } = useSession();
  const canAdd = ["admin", "noc", "engineer"].includes(session?.user.role ?? "");
  const { data, error, isLoading, mutate: mutateIncidents } = useSWR<IncidentsResponse>("/api/v1/incidents?limit=100", getJson<IncidentsResponse>, { refreshInterval: 30_000, revalidateOnFocus: false });
  const incidents = data?.incidents ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<"all" | IncidentView["state"]>("all");
  const [kind, setKind] = useState<IncidentUpdateKind>("catatan");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const filteredIncidents = stateFilter === "all" ? incidents : incidents.filter((incident) => incident.state === stateFilter);
  const selectedIncident = filteredIncidents.find((incident) => incident.id === selectedId) ?? filteredIncidents[0] ?? null;
  const { data: updatesData, error: updatesError, isLoading: updatesLoading, mutate: mutateUpdates } = useSWR<IncidentUpdatesResponse>(selectedIncident ? `/api/v1/incidents/${selectedIncident.id}/updates` : null, getJson<IncidentUpdatesResponse>, { revalidateOnFocus: false });

  async function addUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedIncident || !body.trim()) return;
    setSaving(true);
    setFormError(null);
    try {
      await sendJson("POST", `/api/v1/incidents/${selectedIncident.id}/updates`, { kind, body: body.trim() });
      setBody("");
      await mutateUpdates();
      await mutateIncidents();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Catatan gagal ditambahkan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <NocPanel title="Riwayat incident" description="Kronologi incident LibreNMS dibaca dari yang terlama ke terbaru. Riwayat bersifat append-only." action={<Button type="button" variant="ghost" size="sm" onClick={() => mutateIncidents()}><RefreshCw aria-label="Muat ulang riwayat incident" /></Button>} className="noc-incident-history-panel">
      {error && <NocState kind="error">{error instanceof ApiError ? error.message : "Incident tidak dapat dimuat."} {error instanceof ApiError && error.status === 401 && <Link href="/login" className="noc-inline-link">Masuk kembali</Link>}</NocState>}
      {isLoading && <NocState kind="loading">Memuat daftar incident…</NocState>}
      {!isLoading && !error && incidents.length === 0 && <NocState kind="empty">Belum ada incident yang bisa ditelusuri.</NocState>}
      {!isLoading && !error && incidents.length > 0 && (
        <div className="noc-incident-history-grid">
          <div className="noc-incident-directory">
            <div className="noc-incident-filter"><label htmlFor="incident-state-filter">Tampilkan</label><select id="incident-state-filter" className="noc-field-select" value={stateFilter} onChange={(event) => setStateFilter(event.target.value as "all" | IncidentView["state"])}><option value="all">Semua state</option><option value="open">Terbuka</option><option value="acknowledged">Diakui</option><option value="resolved">Selesai</option></select></div>
            <div className="noc-incident-select-list">{filteredIncidents.map((incident) => <IncidentListRow key={incident.id} incident={incident} selected={selectedIncident?.id === incident.id} onSelect={() => setSelectedId(incident.id)} />)}</div>
          </div>
          <div className="noc-incident-detail">
            {selectedIncident ? (
              <>
                <div className="noc-incident-detail-header"><div><div className="noc-data-row-title"><h3>{selectedIncident.deviceName}</h3><NocStatus label={selectedIncident.severity} tone={incidentTone(selectedIncident.severity)} /></div><p>{selectedIncident.message}</p><small>Dipicu {formatDateTime(selectedIncident.triggeredAt)} · ID alert {selectedIncident.librenmsAlertId}</small></div><NocStatus label={selectedIncident.state === "resolved" ? "Selesai" : selectedIncident.state === "acknowledged" ? "Diakui" : "Terbuka"} tone={selectedIncident.state === "resolved" ? "positive" : selectedIncident.state === "acknowledged" ? "info" : "warning"} /></div>
                {updatesLoading && <NocState kind="loading">Memuat kronologi…</NocState>}
                {updatesError && <NocState kind="error">{updatesError instanceof ApiError ? updatesError.message : "Kronologi tidak dapat dimuat."}</NocState>}
                {!updatesLoading && !updatesError && <IncidentTimeline updates={updatesData?.updates ?? []} />}
                {canAdd && <form className="noc-incident-add-form" onSubmit={addUpdate}><div className="noc-form-grid is-two"><div className="noc-field"><label htmlFor="incident-kind">Jenis catatan</label><select id="incident-kind" className="noc-field-select" value={kind} onChange={(event) => setKind(event.target.value as IncidentUpdateKind)}><option value="catatan">Catatan</option><option value="status">Status</option><option value="eskalasi">Eskalasi</option><option value="penyebab">Penyebab</option><option value="penutupan">Penutupan</option></select></div><div className="noc-field"><label htmlFor="incident-body">Isi catatan</label><textarea id="incident-body" className="noc-textarea" rows={2} required value={body} onChange={(event) => setBody(event.target.value)} placeholder="Tambahkan kejadian atau keputusan baru…" /></div></div>{formError && <NocState kind="error">{formError}</NocState>}<Button type="submit" disabled={saving || !body.trim()}><Plus aria-hidden="true" /> {saving ? "Menambahkan…" : "Tambah ke kronologi"}</Button></form>}
                {!canAdd && <p className="noc-permission-note">Penambahan catatan memerlukan peran admin, NOC, atau engineer.</p>}
              </>
            ) : <NocState kind="empty">Pilih incident untuk melihat kronologinya.</NocState>}
          </div>
        </div>
      )}
      <div className="noc-source-note"><BookOpen aria-hidden="true" /><span>Catatan sistem ditandai sebagai <strong>Sistem</strong>. Tidak tersedia aksi edit atau hapus agar kronologi tetap dapat dipercaya.</span></div>
    </NocPanel>
  );
}
