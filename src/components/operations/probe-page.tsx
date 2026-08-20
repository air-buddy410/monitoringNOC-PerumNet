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
import type { ProbeStatus, ProbeTarget, ProbeTargetsResponse, SchedulerResponse, SchedulerTask } from "@/types/operations";

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

function schedulerIntervalLabel(intervalSec: number) {
  if (intervalSec >= 86_400 && intervalSec % 86_400 === 0) {
    return `Setiap ${intervalSec / 86_400} hari`;
  }
  if (intervalSec >= 3_600 && intervalSec % 3_600 === 0) {
    return `Setiap ${intervalSec / 3_600} jam`;
  }
  if (intervalSec >= 60 && intervalSec % 60 === 0) {
    return `Setiap ${intervalSec / 60} menit`;
  }
  return `Setiap ${intervalSec} detik`;
}

function schedulerDelayLabel(task: SchedulerTask) {
  if (task.lastRunAt === null || task.overdueSec === null) {
    return "Belum ada putaran";
  }
  if (task.overdueSec <= 0) return "Sesuai jadwal";
  if (task.overdueSec < 60) return `${task.overdueSec} detik terlambat`;
  const minutes = Math.floor(task.overdueSec / 60);
  if (minutes < 60) return `${minutes} menit terlambat`;
  const hours = Math.floor(minutes / 60);
  return `${hours} jam terlambat`;
}

function schedulerDurationLabel(durationMs: number | null) {
  if (durationMs === null) return "—";
  if (durationMs < 1_000) return `${durationMs} ms`;
  return `${(durationMs / 1_000).toFixed(durationMs >= 10_000 ? 0 : 1)} detik`;
}

function schedulerStatus(task: SchedulerTask) {
  if (!task.isEnabled) return { label: "Nonaktif", tone: "neutral" as const };
  if (task.stalled) return { label: "Macet", tone: "danger" as const };
  if (task.lastRunAt === null) return { label: "Belum jalan", tone: "neutral" as const };
  if (task.lastStatus === "FAILED") return { label: "Gagal terakhir", tone: "danger" as const };
  if (task.lastStatus === "SUCCESS") return { label: "Berhasil", tone: "positive" as const };
  return { label: task.lastStatus ?? "Belum jalan", tone: "neutral" as const };
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

function SchedulerTaskRow({ task }: { task: SchedulerTask }) {
  const status = schedulerStatus(task);

  return (
    <article
      className={`noc-scheduler-row ${task.stalled ? "is-stalled" : ""} ${!task.isEnabled ? "is-disabled" : ""}`}
      data-testid={`scheduler-task-${task.code}`}
    >
      <div className="noc-scheduler-row-top">
        <span className="noc-scheduler-icon"><TimerReset aria-hidden="true" /></span>
        <div className="noc-scheduler-copy">
          <div className="noc-scheduler-title">
            <strong>{task.name}</strong>
            <span className="noc-scheduler-code">{task.code}</span>
          </div>
          <small>{task.description || "Tidak ada deskripsi pekerjaan."}</small>
        </div>
        <NocStatus label={status.label} tone={status.tone} />
      </div>
      <dl className="noc-scheduler-facts">
        <div className="noc-scheduler-fact">
          <dt>Jadwal</dt>
          <dd>{schedulerIntervalLabel(task.intervalSec)}</dd>
        </div>
        <div className="noc-scheduler-fact">
          <dt>Putaran terakhir</dt>
          <dd>{task.lastRunAt ? formatAge(task.lastRunAt) : "Belum pernah"}</dd>
          <small>{task.lastRunAt ? formatDateTime(task.lastRunAt) : "Tidak ada timestamp"}</small>
        </div>
        <div className="noc-scheduler-fact">
          <dt>Keterlambatan</dt>
          <dd>{schedulerDelayLabel(task)}</dd>
          <small>{task.stalled ? "melewati toleransi macet" : "berdasarkan interval server"}</small>
        </div>
        <div className="noc-scheduler-fact">
          <dt>Putaran / gagal</dt>
          <dd>{formatNumber(task.runCount)} / {formatNumber(task.failCount)}</dd>
          <small>gagal kumulatif</small>
        </div>
        <div className="noc-scheduler-fact">
          <dt>Durasi terakhir</dt>
          <dd>{schedulerDurationLabel(task.lastDurationMs)}</dd>
          <small>{task.isEnabled ? "dibaca dari server" : "pekerjaan nonaktif"}</small>
        </div>
      </dl>
      {task.lastError && (
        <p className="noc-scheduler-error">
          <TriangleAlert aria-hidden="true" />
          <span>{task.lastError}</span>
        </p>
      )}
    </article>
  );
}

function SchedulerPanel({
  data,
  error,
  isLoading,
}: {
  data?: SchedulerResponse;
  error?: unknown;
  isLoading: boolean;
}) {
  const errorMessage = error instanceof ApiError
    ? error.message
    : "Status penjadwal tidak dapat dimuat.";

  return (
    <NocPanel title="Pekerjaan worker" description="Status terakhir, jadwal, dan keterlambatan dibaca dari server. Panel ini hanya melaporkan.">
      {Boolean(error) && (
        <NocState kind="error">
          {data ? `${errorMessage} Data terakhir tetap ditampilkan.` : errorMessage}
        </NocState>
      )}
      {isLoading && !data && !error && <NocState kind="loading">Memuat status worker…</NocState>}
      {!isLoading && !data && !error && <NocState kind="empty">Status penjadwal belum tersedia.</NocState>}
      {data && data.tasks.length === 0 && <NocState kind="empty">Belum ada pekerjaan terjadwal.</NocState>}
      {data && data.tasks.length > 0 && (
        <div className="noc-scheduler-list">
          {data.tasks.map((task) => <SchedulerTaskRow key={task.code} task={task} />)}
        </div>
      )}
    </NocPanel>
  );
}

export default function ProbePage() {
  const { session } = useSession();
  const canManage = session?.user.role === "admin" || session?.user.role === "noc";
  const { data, error, isLoading, mutate } = useSWR<ProbeTargetsResponse>("/api/v1/probe-targets", getJson<ProbeTargetsResponse>, { refreshInterval: 30_000, revalidateOnFocus: false });
  const { data: scheduler, error: schedulerError, isLoading: schedulerLoading, mutate: mutateScheduler } = useSWR<SchedulerResponse>("/api/v1/scheduler", getJson<SchedulerResponse>, { refreshInterval: 30_000, revalidateOnFocus: false });
  const [form, setForm] = useState<ProbeForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const targets = data?.targets ?? [];
  const upCount = targets.filter((target) => target.status === "UP").length;
  const downCount = targets.filter((target) => target.status === "DOWN").length;
  const unseenCount = targets.filter((target) => target.status === null).length;

  function refreshData() {
    void Promise.all([mutate(), mutateScheduler()]);
  }

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
      <NocPageHeader title="Probe keterjangkauan" description="Pantau pengukuran TCP milik portal sendiri, terpisah dari incident LibreNMS." action={<Button type="button" variant="outline" size="sm" onClick={refreshData}><RefreshCw aria-label="Muat ulang sasaran probe dan worker" /> Muat ulang</Button>} />
      {scheduler?.workerLikelyDown && <div className="noc-worker-warning"><TriangleAlert aria-hidden="true" /><span><strong>Worker kemungkinan berhenti</strong><small>Data probe dapat membeku sampai worker kembali berjalan.</small></span></div>}
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
        <SchedulerPanel data={scheduler} error={schedulerError} isLoading={schedulerLoading} />
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
