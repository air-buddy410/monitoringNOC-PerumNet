"use client";

import { useState } from "react";
import useSWR from "swr";
import { BellRing, Check, RefreshCw, ShieldAlert, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError, getJson, sendJson } from "@/lib/api/http";
import { formatAge, formatDateTime, formatNumber } from "@/lib/noc-format";
import { NocPageHeader, NocMetric, NocPanel, NocState, NocStatus } from "@/components/noc-ui";
import type { AlarmsResponse, NetworkAlarm, SchedulerResponse } from "@/types/operations";

function severityTone(severity: string) {
  return severity.toLowerCase() === "critical" ? "danger" as const : "warning" as const;
}

function AlarmRow({ alarm, onAcknowledged }: { alarm: NetworkAlarm; onAcknowledged: () => void }) {
  const canAcknowledge = !alarm.acknowledgedAt && !alarm.clearedAt;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function acknowledge() {
    setBusy(true);
    setError(null);
    try {
      await sendJson("POST", `/api/v1/alarms/${alarm.id}/acknowledge`);
      onAcknowledged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Alarm gagal ditandai.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`noc-alarm-row ${alarm.clearedAt ? "is-cleared" : ""}`}>
      <div className="noc-alarm-severity"><TriangleAlert aria-hidden="true" /><NocStatus label={alarm.severity} tone={severityTone(alarm.severity)} /></div>
      <div className="noc-alarm-main"><div className="noc-data-row-title"><strong>{alarm.alarmNumber}</strong><NocStatus label={alarm.source} tone="info" dot={false} /></div><p>{alarm.message}</p><small>{alarm.assetId ? `Asset ${alarm.assetId} · ` : ""}Gangguan yang sama terulang <strong>{formatNumber(alarm.count)}×</strong></small></div>
      <div className="noc-alarm-times"><span>Mulai <strong>{formatAge(alarm.occurredAt)}</strong><small>{formatDateTime(alarm.occurredAt)}</small></span><span>Terakhir <strong>{formatAge(alarm.lastSeenAt)}</strong><small>{formatDateTime(alarm.lastSeenAt)}</small></span></div>
      <div className="noc-alarm-action">{alarm.clearedAt ? <NocStatus label="Sudah pulih" tone="positive" /> : alarm.acknowledgedAt ? <NocStatus label="Sudah dilihat" tone="info" /> : canAcknowledge ? <Button type="button" size="sm" variant="outline" onClick={acknowledge} disabled={busy}><Check aria-hidden="true" /> {busy ? "…" : "Tandai sudah dilihat"}</Button> : null}{error && <small className="noc-inline-error">{error}</small>}</div>
    </article>
  );
}

export default function AlarmsPage() {
  const [includeClosed, setIncludeClosed] = useState(false);
  const endpoint = includeClosed ? "/api/v1/alarms?semua=1" : "/api/v1/alarms";
  const { data, error, isLoading, mutate } = useSWR<AlarmsResponse>(endpoint, getJson<AlarmsResponse>, { refreshInterval: 30_000, revalidateOnFocus: false });
  const { data: scheduler } = useSWR<SchedulerResponse>("/api/v1/scheduler", getJson<SchedulerResponse>, { refreshInterval: 30_000, revalidateOnFocus: false });
  const alarms = data?.alarms ?? [];
  const openCount = alarms.filter((alarm) => !alarm.clearedAt).length;
  const unseenCount = alarms.filter((alarm) => !alarm.acknowledgedAt && !alarm.clearedAt).length;

  return (
    <main className="noc-page noc-feature-page">
      <NocPageHeader title="Alarm probe" description="Gangguan yang disimpulkan portal dari probe TCP, bukan incident yang dikirim LibreNMS." action={<Button type="button" variant="outline" size="sm" onClick={() => mutate()}><RefreshCw aria-label="Muat ulang alarm" /> Muat ulang</Button>} />
      {scheduler?.workerLikelyDown && <div className="noc-worker-warning"><TriangleAlert aria-hidden="true" /><span><strong>Worker kemungkinan berhenti</strong><small>Daftar alarm dan sasaran dapat terlihat membeku tanpa error baru.</small></span></div>}
      <div className="noc-feature-metrics is-three"><NocMetric label="Alarm ditampilkan" value={alarms.length} note={includeClosed ? "Termasuk yang sudah pulih" : "Alarm terbuka"} /><NocMetric label="Belum ditandai" value={unseenCount} note="Perlu dilihat operator" /><NocMetric label="Terbuka" value={openCount} note="Tidak ditutup oleh acknowledge" /></div>
      <NocPanel title="Daftar alarm" description="Satu baris mewakili satu gangguan yang sama; count menunjukkan pengulangannya." action={<Button type="button" size="sm" variant={includeClosed ? "secondary" : "outline"} onClick={() => setIncludeClosed((value) => !value)}><BellRing aria-hidden="true" /> {includeClosed ? "Sembunyikan yang pulih" : "Tampilkan yang pulih"}</Button>}>
        {isLoading && <NocState kind="loading">Memuat alarm…</NocState>}
        {error && <NocState kind="error">{error instanceof ApiError ? error.message : "Alarm tidak dapat dimuat."}</NocState>}
        {!isLoading && !error && alarms.length === 0 && <NocState kind="empty">Tidak ada alarm pada penyaring ini.</NocState>}
        <div className="noc-alarm-list">{alarms.map((alarm) => <AlarmRow key={alarm.id} alarm={alarm} onAcknowledged={() => mutate()} />)}</div>
      </NocPanel>
      <div className="noc-source-note"><ShieldAlert aria-hidden="true" /><span><strong>Sumber terpisah</strong> · Alarm di halaman ini berasal dari probe portal. Incident LibreNMS tetap ditelusuri di Notifikasi.</span></div>
    </main>
  );
}
