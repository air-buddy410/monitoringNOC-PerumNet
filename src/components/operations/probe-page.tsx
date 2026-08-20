"use client";

import { useState } from "react";
import useSWR from "swr";
import { Plus, RefreshCw, TimerReset, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, getJson, sendJson } from "@/lib/api/http";
import { formatAge, formatDateTime, formatNumber } from "@/lib/noc-format";
import { NocPageHeader, NocMetric, NocPanel, NocState, NocStatus } from "@/components/noc-ui";
import { useSession } from "@/hooks/use-session";
import type { ProbeStatus, ProbeTarget, ProbeTargetsResponse, SchedulerResponse } from "@/types/operations";

function probeTone(status: ProbeStatus) {
  if (status === "UP") return "positive" as const;
  if (status === "DOWN") return "danger" as const;
  return "neutral" as const;
}

function probeLabel(status: ProbeStatus) {
  if (status === "UP") return "UP";
  if (status === "DOWN") return "DOWN";
  return "Belum diperiksa";
}

interface ProbeForm {
  name: string;
  address: string;
  port: string;
  severity: "warning" | "critical";
  intervalSec: string;
  timeoutMs: string;
  failThreshold: string;
}

const emptyForm: ProbeForm = {
  name: "",
  address: "",
  port: "443",
  severity: "critical",
  intervalSec: "60",
  timeoutMs: "3000",
  failThreshold: "3",
};

function TargetRow({ target }: { target: ProbeTarget }) {
  return (
    <tr>
      <td><div className="noc-table-primary"><strong>{target.name}</strong><small>{target.address}:{target.port}</small></div></td>
      <td><NocStatus label={probeLabel(target.status)} tone={probeTone(target.status)} /></td>
      <td>{target.latencyMs === null ? "—" : `${target.latencyMs} ms`}</td>
      <td><span className="noc-fail-count">{target.consecutiveFails}/{target.failThreshold}</span></td>
      <td>{target.checkedAt ? <span className="noc-table-time">{formatAge(target.checkedAt)}<small>{formatDateTime(target.checkedAt)}</small></span> : "—"}</td>
      <td>{target.hasOpenAlarm ? <NocStatus label="Alarm terbuka" tone="danger" /> : <NocStatus label="Normal" tone="neutral" />}</td>
    </tr>
  );
}

export default function ProbePage() {
  const { session } = useSession();
  const canManage = session?.user.role === "admin" || session?.user.role === "noc";
  const { data, error, isLoading, mutate } = useSWR<ProbeTargetsResponse>("/api/v1/probe-targets", getJson<ProbeTargetsResponse>, { refreshInterval: 30_000, revalidateOnFocus: false });
  const { data: scheduler, error: schedulerError } = useSWR<SchedulerResponse>("/api/v1/scheduler", getJson<SchedulerResponse>, { refreshInterval: 30_000, revalidateOnFocus: false });
  const [form, setForm] = useState<ProbeForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const targets = data?.targets ?? [];
  const upCount = targets.filter((target) => target.status === "UP").length;
  const downCount = targets.filter((target) => target.status === "DOWN").length;
  const unseenCount = targets.filter((target) => target.status === null).length;

  async function createTarget(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await sendJson("POST", "/api/v1/probe-targets", {
        name: form.name,
        address: form.address,
        port: Number(form.port),
        severity: form.severity,
        intervalSec: Number(form.intervalSec),
        timeoutMs: Number(form.timeoutMs),
        failThreshold: Number(form.failThreshold),
      });
      setForm(emptyForm);
      await mutate();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Sasaran probe gagal disimpan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="noc-page noc-feature-page">
      <NocPageHeader title="Probe keterjangkauan" description="Pantau pengukuran TCP milik portal sendiri, terpisah dari incident LibreNMS." action={<Button type="button" variant="outline" size="sm" onClick={() => mutate()}><RefreshCw aria-label="Muat ulang sasaran probe" /> Muat ulang</Button>} />
      {scheduler?.workerLikelyDown && <div className="noc-worker-warning"><TriangleAlert aria-hidden="true" /><span><strong>Worker kemungkinan berhenti</strong><small>Data probe dapat membeku sampai worker kembali berjalan.</small></span></div>}
      {schedulerError && <p className="noc-feature-muted">Status worker belum dapat dibaca.</p>}
      <div className="noc-feature-metrics is-four">
        <NocMetric label="Sasaran" value={formatNumber(targets.length)} note="Terdaftar di portal" />
        <NocMetric label="UP" value={formatNumber(upCount)} note="Respons terakhir berhasil" />
        <NocMetric label="DOWN" value={formatNumber(downCount)} note="Respons terakhir gagal" />
        <NocMetric label="Belum diperiksa" value={formatNumber(unseenCount)} note="Bukan DOWN" />
      </div>
      <div className="noc-feature-grid is-two-column">
        <NocPanel title="Daftarkan sasaran" description="Ambang minimum 1 kegagalan dan interval minimum 10 detik dijaga server.">
          {canManage ? (
            <form className="noc-feature-form" onSubmit={createTarget}>
              <div className="noc-form-grid is-two">
                <div className="noc-field"><Label htmlFor="probe-name">Nama sasaran</Label><Input id="probe-name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Gateway kantor" /></div>
                <div className="noc-field"><Label htmlFor="probe-address">Alamat</Label><Input id="probe-address" required value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} placeholder="10.0.0.1" /></div>
                <div className="noc-field"><Label htmlFor="probe-port">Port TCP</Label><Input id="probe-port" required type="number" min={1} max={65535} value={form.port} onChange={(event) => setForm({ ...form, port: event.target.value })} /></div>
                <div className="noc-field"><Label htmlFor="probe-severity">Severity alarm</Label><select id="probe-severity" className="noc-field-select" value={form.severity} onChange={(event) => setForm({ ...form, severity: event.target.value as "warning" | "critical" })}><option value="critical">Critical</option><option value="warning">Warning</option></select></div>
                <div className="noc-field"><Label htmlFor="probe-interval">Interval (detik)</Label><Input id="probe-interval" required type="number" min={10} value={form.intervalSec} onChange={(event) => setForm({ ...form, intervalSec: event.target.value })} /></div>
                <div className="noc-field"><Label htmlFor="probe-timeout">Timeout (ms)</Label><Input id="probe-timeout" required type="number" min={1} value={form.timeoutMs} onChange={(event) => setForm({ ...form, timeoutMs: event.target.value })} /></div>
                <div className="noc-field"><Label htmlFor="probe-threshold">Ambang gagal</Label><Input id="probe-threshold" required type="number" min={1} value={form.failThreshold} onChange={(event) => setForm({ ...form, failThreshold: event.target.value })} /></div>
              </div>
              {formError && <NocState kind="error">{formError}</NocState>}
              <Button type="submit" disabled={saving}><Plus aria-hidden="true" /> {saving ? "Menyimpan…" : "Daftarkan probe"}</Button>
            </form>
          ) : <NocState kind="empty">Pendaftaran probe memerlukan peran admin atau NOC.</NocState>}
        </NocPanel>
        <NocPanel title="Pekerjaan worker" description="Tanda macet memakai toleransi tiga kali interval.">
          {!scheduler && <NocState kind="loading">Memuat status worker…</NocState>}
          {scheduler && scheduler.tasks.length === 0 && <NocState kind="empty">Belum ada pekerjaan terjadwal.</NocState>}
          {scheduler && scheduler.tasks.length > 0 && <div className="noc-scheduler-list">{scheduler.tasks.map((task) => <div key={task.code} className={`noc-scheduler-row ${task.stalled ? "is-stalled" : ""}`}><span className="noc-scheduler-icon"><TimerReset aria-hidden="true" /></span><span><strong>{task.name}</strong><small>{task.description || task.code}</small></span><span>{task.stalled ? <NocStatus label="Macet" tone="danger" /> : task.lastStatus ? <NocStatus label={task.lastStatus} tone="positive" /> : <NocStatus label="Belum jalan" tone="neutral" />}</span></div>)}</div>}
        </NocPanel>
      </div>
      <NocPanel title="Sasaran terdaftar" description="Status null sengaja ditampilkan netral: belum pernah diperiksa bukan berarti DOWN.">
        {isLoading && <NocState kind="loading">Memuat sasaran probe…</NocState>}
        {error && <NocState kind="error">{error instanceof ApiError ? error.message : "Sasaran probe tidak dapat dimuat."}</NocState>}
        {!isLoading && !error && targets.length === 0 && <NocState kind="empty">Belum ada sasaran probe.</NocState>}
        {targets.length > 0 && <div className="noc-mini-table-wrap"><table className="noc-mini-table noc-probe-table"><thead><tr><th>Sasaran</th><th>Status</th><th>Latency</th><th>Gagal berturut</th><th>Diperiksa</th><th>Alarm</th></tr></thead><tbody>{targets.map((target) => <TargetRow key={target.id} target={target} />)}</tbody></table></div>}
      </NocPanel>
    </main>
  );
}
