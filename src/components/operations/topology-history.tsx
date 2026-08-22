"use client";

import { ChevronDown, Clock3, RefreshCw, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import useSWRInfinite from "swr/infinite";
import { NocPanel, NocState } from "@/components/noc-ui";
import { Button } from "@/components/ui/button";
import { ApiError, getJson } from "@/lib/api/http";
import { formatDateTime } from "@/lib/noc-format";
import type {
  TopologyHistoryEntityType,
  TopologyHistoryResponse,
  TopologyHistoryRow,
} from "@/types/operations";

const HISTORY_PAGE_SIZE = 30;

function buildHistoryUrl(entityType: TopologyHistoryEntityType, entityId: string, cursor?: string) {
  const params = new URLSearchParams({
    jenis: entityType,
    id: entityId,
    limit: String(HISTORY_PAGE_SIZE),
  });
  if (cursor) params.set("sesudah", cursor);
  return `/api/v1/ftth/riwayat?${params.toString()}`;
}

function formatDetailValue(value: unknown) {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function TopologyHistoryRowView({ row }: { row: TopologyHistoryRow }) {
  const detailEntries = Object.entries(row.detail ?? {});

  return (
    <article className="noc-topology-history-item">
      <span className="noc-topology-history-marker" aria-hidden="true" />
      <div className="noc-topology-history-content">
        <p className="noc-topology-history-summary">{row.ringkas}</p>
        <div className="noc-topology-history-meta">
          <span><Clock3 aria-hidden="true" /> {formatDateTime(row.waktu)}</span>
          <span><UserRound aria-hidden="true" /> {row.oleh || "—"}</span>
        </div>
        <details className="noc-topology-history-details">
          <summary>
            <span>Detail perubahan</span>
            <ChevronDown aria-hidden="true" />
          </summary>
          <dl className="noc-topology-history-facts">
            <div>
              <dt>Aksi</dt>
              <dd><code>{row.action}</code></dd>
            </div>
            <div>
              <dt>Entitas</dt>
              <dd><code>{row.entityType}</code></dd>
            </div>
            <div>
              <dt>ID entitas</dt>
              <dd><code>{row.entityId}</code></dd>
            </div>
            {detailEntries.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{formatDetailValue(value)}</dd>
              </div>
            ))}
          </dl>
          {detailEntries.length === 0 && <p className="noc-topology-history-no-detail">Tidak ada detail tambahan.</p>}
        </details>
      </div>
    </article>
  );
}

export function TopologyHistoryPanel({
  entityType,
  entityId,
  title = "Riwayat topologi",
  description = "Perubahan terbaru ditampilkan lebih dulu. Riwayat mencakup entitas yang menempel sesuai ruang lingkup server.",
}: {
  entityType: TopologyHistoryEntityType;
  entityId: string;
  title?: string;
  description?: string;
}) {
  const historyUrl = useMemo(() => {
    return buildHistoryUrl(entityType, entityId);
  }, [entityId, entityType]);
  const getHistoryKey = (pageIndex: number, previousPageData: TopologyHistoryResponse | null) => {
    if (pageIndex === 0) return historyUrl;
    if (!previousPageData?.berikutnya) return null;
    return buildHistoryUrl(entityType, entityId, previousPageData.berikutnya);
  };
  const { data, error, isLoading, mutate, setSize, size } = useSWRInfinite<TopologyHistoryResponse>(getHistoryKey, getJson<TopologyHistoryResponse>, { revalidateOnFocus: false });
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const pages = useMemo(
    () => (data ?? []).filter((page): page is TopologyHistoryResponse => Boolean(page)),
    [data],
  );
  const rows = useMemo(() => pages.flatMap((page) => page.baris), [pages]);
  const nextCursor = pages.at(-1)?.berikutnya ?? null;
  const initialError = error && pages.length === 0 ? error : null;
  const paginationError = error && pages.length > 0 ? error : null;

  async function refresh() {
    setRefreshing(true);
    try {
      await setSize(1);
      await mutate();
    } finally {
      setRefreshing(false);
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await setSize(size + 1);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <NocPanel
      title={title}
      description={description}
      className="noc-topology-history-panel"
      action={<Button type="button" size="sm" variant="ghost" onClick={() => { void refresh(); }} disabled={isLoading || refreshing} aria-label="Muat ulang riwayat topologi"><RefreshCw aria-hidden="true" /></Button>}
    >
      {isLoading && <NocState kind="loading">Memuat riwayat topologi…</NocState>}
      {initialError && <NocState kind="error">{initialError instanceof ApiError ? initialError.message : "Riwayat topologi tidak dapat dimuat."}</NocState>}
      {!isLoading && !initialError && rows.length === 0 && <NocState kind="empty">Belum ada perubahan topologi pada entitas ini.</NocState>}
      {!isLoading && !initialError && rows.length > 0 && (
        <>
          <div className="noc-topology-history-list">
            {rows.map((row) => <TopologyHistoryRowView key={row.id} row={row} />)}
          </div>
          {paginationError && <NocState kind="error">{paginationError instanceof ApiError ? paginationError.message : "Riwayat berikutnya tidak dapat dimuat."}</NocState>}
          {nextCursor ? (
            <div className="noc-topology-history-more">
              <Button type="button" size="sm" variant="outline" onClick={() => { void loadMore(); }} disabled={loadingMore}>
                {loadingMore ? "Memuat…" : "Muat lebih banyak"}
              </Button>
            </div>
          ) : <p className="noc-topology-history-end">Seluruh riwayat yang tersedia sudah ditampilkan.</p>}
        </>
      )}
    </NocPanel>
  );
}
