"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  RefreshCw,
  Search,
} from "lucide-react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NocPageHeader, NocMetric, NocPanel, NocState, NocStatus } from "@/components/noc-ui";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ApiError, getJson } from "@/lib/api/http";
import { formatAge, formatDateTime, formatDuration, formatNumber } from "@/lib/noc-format";
import type {
  PppoeLastRun,
  PppoePageSize,
  PppoeRunStatus,
  PppoeSession,
  PppoeSessionsResponse,
  PppoeSortColumn,
} from "@/types/operations";

const PAGE_SIZES: PppoePageSize[] = [20, 50, 100];

const SORT_LABELS: Record<PppoeSortColumn, string> = {
  username: "Username",
  address: "IP",
  uptime: "Uptime",
  seenAt: "Terlihat",
  router: "Router",
};

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

function buildSessionsUrl({
  query,
  router,
  sort,
  dir,
  page,
  pageSize,
}: {
  query: string;
  router: string;
  sort: PppoeSortColumn;
  dir: "asc" | "desc";
  page: number;
  pageSize: PppoePageSize;
}) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    sort,
    dir,
  });
  if (query.trim()) params.set("q", query.trim());
  if (router) params.set("router", router);
  return `/api/v1/pppoe/sessions?${params.toString()}`;
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

function SortHeader({
  column,
  sort,
  dir,
  onChange,
}: {
  column: PppoeSortColumn;
  sort: PppoeSortColumn;
  dir: "asc" | "desc";
  onChange: (column: PppoeSortColumn) => void;
}) {
  const active = sort === column;
  const Icon = active ? (dir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
  return (
    <th aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="noc-session-sort-button" onClick={() => onChange(column)} aria-label={`Urutkan berdasarkan ${SORT_LABELS[column]}`}>
        <span>{SORT_LABELS[column]}</span><Icon aria-hidden="true" />
      </button>
    </th>
  );
}

function sessionKey(session: PppoeSession) {
  return `${session.username}-${session.routerName ?? "router"}-${session.address ?? "ip"}-${session.seenAt}`;
}

function SessionTable({
  sessions,
  sort,
  dir,
  onSort,
}: {
  sessions: PppoeSession[];
  sort: PppoeSortColumn;
  dir: "asc" | "desc";
  onSort: (column: PppoeSortColumn) => void;
}) {
  return (
    <div className="noc-mini-table-wrap noc-session-desktop">
      <table className="noc-mini-table noc-session-table">
        <thead><tr><SortHeader column="username" sort={sort} dir={dir} onChange={onSort} /><SortHeader column="address" sort={sort} dir={dir} onChange={onSort} /><th>Caller ID</th><SortHeader column="uptime" sort={sort} dir={dir} onChange={onSort} /><SortHeader column="router" sort={sort} dir={dir} onChange={onSort} /><SortHeader column="seenAt" sort={sort} dir={dir} onChange={onSort} /></tr></thead>
        <tbody>{sessions.map((session) => <tr key={sessionKey(session)}><td className="is-mono is-strong">{session.username}</td><td className="is-mono">{session.address || "—"}</td><td>{session.callerId || "—"}</td><td>{formatDuration(session.uptimeSec)}</td><td>{session.routerName || "—"}</td><td><span className="noc-table-time">{formatAge(session.seenAt)}<small>{formatDateTime(session.seenAt)}</small></span></td></tr>)}</tbody>
      </table>
    </div>
  );
}

function SessionCards({ sessions }: { sessions: PppoeSession[] }) {
  return (
    <div className="noc-session-cards">
      {sessions.map((session) => (
        <article className="noc-session-card" key={sessionKey(session)}>
          <div className="noc-session-card-heading"><strong>{session.username}</strong><span>{session.routerName || "Router belum diketahui"}</span></div>
          <dl className="noc-session-card-facts">
            <div><dt>IP</dt><dd>{session.address || "—"}</dd></div>
            <div><dt>Caller ID</dt><dd>{session.callerId || "—"}</dd></div>
            <div><dt>Uptime</dt><dd>{formatDuration(session.uptimeSec)}</dd></div>
            <div><dt>Terlihat</dt><dd>{formatAge(session.seenAt)}<small>{formatDateTime(session.seenAt)}</small></dd></div>
          </dl>
        </article>
      ))}
    </div>
  );
}

function SessionPagination({
  page,
  lastPage,
  total,
  pageSize,
  isValidating,
  onPageChange,
}: {
  page: number;
  lastPage: number;
  total: number;
  pageSize: PppoePageSize;
  isValidating: boolean;
  onPageChange: (page: number) => void;
}) {
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <div className="noc-session-pagination">
      <span>Menampilkan {formatNumber(first)}–{formatNumber(last)} dari {formatNumber(total)}</span>
      <div>
        <Button type="button" variant="outline" size="icon-sm" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={isValidating || page <= 1} aria-label="Halaman sebelumnya"><ChevronLeft aria-hidden="true" /></Button>
        <strong>Halaman {formatNumber(page)} / {formatNumber(lastPage)}</strong>
        <Button type="button" variant="outline" size="icon-sm" onClick={() => onPageChange(Math.min(lastPage, page + 1))} disabled={isValidating || page >= lastPage} aria-label="Halaman berikutnya"><ChevronRight aria-hidden="true" /></Button>
      </div>
    </div>
  );
}

export default function PppoePage() {
  const [query, setQuery] = useState("");
  const [router, setRouter] = useState("");
  const [sort, setSort] = useState<PppoeSortColumn>("username");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PppoePageSize>(20);
  const debouncedQuery = useDebouncedValue(query, 300);
  const requestUrl = useMemo(() => buildSessionsUrl({ query: debouncedQuery, router, sort, dir, page, pageSize }), [debouncedQuery, router, sort, dir, page, pageSize]);
  const { data, error, isLoading, isValidating, mutate } = useSWR<PppoeSessionsResponse>(
    requestUrl,
    getJson<PppoeSessionsResponse>,
    { revalidateOnFocus: false, keepPreviousData: true },
  );
  const sessions = data?.sessions ?? [];
  const lastRun = data?.lastRun ?? null;
  const staleReference = lastRun?.finishedAt ?? lastRun?.startedAt ?? null;
  const currentPage = data?.page ?? page;
  const lastPage = Math.max(data?.halamanTerakhir ?? 1, 1);
  const total = data?.total ?? 0;

  function changeSort(column: PppoeSortColumn) {
    setPage(1);
    if (column === sort) {
      setDir((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSort(column);
    setDir("asc");
  }

  return (
    <main className="noc-page noc-feature-page">
      <NocPageHeader title="Sesi PPPoE" description="Gambaran sesi aktif menurut penarikan terakhir dari router distribusi." action={<Button type="button" variant="outline" size="sm" onClick={() => mutate()}><RefreshCw aria-label="Muat ulang sesi PPPoE" /> Muat ulang</Button>} />
      {error && !data && <NocState kind="error">{error instanceof ApiError ? error.message : "Sesi PPPoE tidak dapat dimuat."}</NocState>}
      {isLoading && !data && <NocState kind="loading">Memuat penarikan terakhir…</NocState>}
      {data && (
        <>
          {error && <NocState kind="error">{error instanceof ApiError ? error.message : "Pembaruan sesi PPPoE gagal; data terakhir tetap ditampilkan."}</NocState>}
          <NocPanel title="Kesehatan sumber data" description="Umur penarikan selalu ditampilkan agar daftar sesi tidak terlihat lebih baru dari kenyataannya.">
            <LastRunSummary lastRun={lastRun} />
          </NocPanel>
          <div className="noc-feature-metrics is-three">
            <NocMetric label="Hasil saringan" value={formatNumber(total)} note="Total setelah filter server" />
            <NocMetric label="Router tersedia" value={formatNumber(data.routers.length)} note="Pilihan filter dari server" />
            <NocMetric label="Halaman" value={`${formatNumber(currentPage)}/${formatNumber(lastPage)}`} note={`Data ${formatAge(staleReference)}`} />
          </div>
          <NocPanel title="Daftar sesi" description={lastRun?.status === "FAILED" ? "Penarikan terakhir gagal; daftar ini masih dipertahankan sebagai gambaran terakhir yang tersedia." : "Pencarian dan urutan dikerjakan database; tabel hanya menampilkan halaman yang diminta."} action={isValidating ? <span className="noc-session-refreshing">Memperbarui…</span> : undefined}>
            <div className="noc-session-toolbar" aria-label="Saringan sesi PPPoE">
              <label className="noc-session-search"><Search aria-hidden="true" /><span>Cari sesi</span><Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Username, IP, atau Caller ID" aria-label="Cari username, IP, atau Caller ID" /></label>
              <label className="noc-session-control"><span>Router</span><select className="noc-field-select" value={router} onChange={(event) => { setRouter(event.target.value); setPage(1); }} aria-label="Filter router"><option value="">Semua router</option>{data.routers.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
              <label className="noc-session-control"><span>Baris</span><select className="noc-field-select" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value) as PppoePageSize); setPage(1); }} aria-label="Jumlah baris per halaman">{PAGE_SIZES.map((value) => <option key={value} value={value}>{value} baris</option>)}</select></label>
            </div>
            {sessions.length === 0 ? <NocState kind="empty">{query.trim() || router ? "Tidak ada sesi yang cocok dengan saringan ini." : "Belum ada sesi yang tersimpan dari penarikan terakhir."}</NocState> : <><SessionTable sessions={sessions} sort={sort} dir={dir} onSort={changeSort} /><SessionCards sessions={sessions} /></>}
            <SessionPagination page={currentPage} lastPage={lastPage} total={total} pageSize={pageSize} isValidating={isValidating} onPageChange={setPage} />
          </NocPanel>
        </>
      )}
    </main>
  );
}
