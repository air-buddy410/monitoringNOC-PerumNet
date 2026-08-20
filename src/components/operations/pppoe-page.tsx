"use client";

import useSWR from "swr";
import { Activity, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError, getJson } from "@/lib/api/http";
import { formatAge, formatDateTime, formatDuration, formatNumber } from "@/lib/noc-format";
import { NocPageHeader, NocMetric, NocPanel, NocState, NocStatus } from "@/components/noc-ui";
import type { PppoeLastRun, PppoeRunStatus, PppoeSessionsResponse } from "@/types/operations";

function runTone(status: PppoeRunStatus) {
  if (status === "SUCCESS") return "positive" as const;
  if (status === "FAILED") return "danger" as const;
  if (status === "RUNNING") return "info" as const;
  return "neutral" as const;
}

function runLabel(status: PppoeRunStatus) {
  if (status === "SUCCESS") return "Berhasil";
  if (status === "FAILED") return "Gagal";
  if (status === "RUNNING") return "Sedang berjalan";
  return "Dilewati · router belum dikonfigurasi";
}

function LastRunSummary({ lastRun }: { lastRun: PppoeLastRun | null }) {
  if (!lastRun) {
    return <NocState kind="empty">Belum ada penarikan sesi PPPoE. Daftar di bawah belum dapat dianggap sebagai kondisi terkini.</NocState>;
  }
  const referenceTime = lastRun.finishedAt ?? lastRun.startedAt;
  return (
    <div className="noc-run-summary">
      <div className="noc-run-status">
        <span className="noc-data-row-leading is-pppoe"><Activity aria-hidden="true" /></span>
        <div><span>Penarikan terakhir</span><strong><NocStatus label={runLabel(lastRun.status)} tone={runTone(lastRun.status)} /></strong></div>
      </div>
      <div className="noc-run-facts">
        <div><span>Mulai</span><strong>{formatDateTime(lastRun.startedAt)}</strong></div>
        <div><span>Selesai</span><strong>{formatDateTime(lastRun.finishedAt)}</strong></div>
        <div><span>Umur data</span><strong>{formatAge(referenceTime)}</strong></div>
        <div><span>Sesi saat itu</span><strong>{formatNumber(lastRun.sessionCount)}</strong></div>
      </div>
      {lastRun.status === "SKIPPED" && <p className="noc-run-note is-neutral">Router belum dikonfigurasi. Ini keadaan yang valid hari ini, bukan kegagalan penarikan.</p>}
      {lastRun.status === "FAILED" && <p className="noc-run-note is-danger">{lastRun.error || "Penarikan gagal; daftar sesi terakhir tetap ditampilkan sebagai data yang tua."}</p>}
      {lastRun.status === "RUNNING" && <p className="noc-run-note is-info">Penarikan sedang berlangsung. Umur data akan diperbarui setelah worker selesai.</p>}
    </div>
  );
}

export default function PppoePage() {
  const { data, error, isLoading, mutate } = useSWR<PppoeSessionsResponse>(
    "/api/v1/pppoe/sessions",
    getJson<PppoeSessionsResponse>,
    { revalidateOnFocus: false },
  );
  const sessions = data?.sessions ?? [];
  const lastRun = data?.lastRun ?? null;
  const staleReference = lastRun?.finishedAt ?? lastRun?.startedAt ?? null;

  return (
    <main className="noc-page noc-feature-page">
      <NocPageHeader title="Sesi PPPoE" description="Gambaran sesi aktif menurut penarikan terakhir dari router distribusi." action={<Button type="button" variant="outline" size="sm" onClick={() => mutate()}><RefreshCw aria-label="Muat ulang sesi PPPoE" /> Muat ulang</Button>} />
      {error && <NocState kind="error">{error instanceof ApiError ? error.message : "Sesi PPPoE tidak dapat dimuat."}</NocState>}
      {isLoading && <NocState kind="loading">Memuat penarikan terakhir…</NocState>}
      {!isLoading && !error && (
        <>
          <NocPanel title="Kesehatan sumber data" description="Umur penarikan selalu ditampilkan agar daftar sesi tidak terlihat lebih baru dari kenyataannya.">
            <LastRunSummary lastRun={lastRun} />
          </NocPanel>
          <div className="noc-feature-metrics is-three">
            <NocMetric label="Sesi ditampilkan" value={formatNumber(sessions.length)} note="Maksimum 2.000 sesi" />
            <NocMetric label="Router" value={new Set(sessions.map((session) => session.routerName).filter(Boolean)).size || "—"} note="Dari penarikan terakhir" />
            <NocMetric label="Data sesi" value={formatAge(staleReference)} note="Berdasarkan seenAt penarikan" />
          </div>
          <NocPanel title="Daftar sesi" description={lastRun?.status === "FAILED" ? "Penarikan terakhir gagal; daftar ini masih dipertahankan sebagai gambaran terakhir yang tersedia." : "Tidak ada nama pelanggan di sumber data ini."}>
            {sessions.length === 0 ? <NocState kind="empty">Belum ada sesi yang tersimpan dari penarikan terakhir.</NocState> : (
              <div className="noc-mini-table-wrap">
                <table className="noc-mini-table noc-session-table">
                  <thead><tr><th>Username</th><th>Alamat</th><th>Caller ID</th><th>Uptime</th><th>Router</th><th>Terlihat</th></tr></thead>
                  <tbody>{sessions.map((session) => <tr key={`${session.username}-${session.routerName ?? "router"}`}><td className="is-mono is-strong">{session.username}</td><td className="is-mono">{session.address || "—"}</td><td>{session.callerId || "—"}</td><td>{formatDuration(session.uptimeSec)}</td><td>{session.routerName || "—"}</td><td><span className="noc-table-time">{formatAge(session.seenAt)}<small>{formatDateTime(session.seenAt)}</small></span></td></tr>)}</tbody>
                </table>
              </div>
            )}
          </NocPanel>
        </>
      )}
    </main>
  );
}
