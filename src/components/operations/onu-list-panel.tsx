"use client";

import { useState, type FormEvent } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NocPanel, NocState, NocStatus } from "@/components/noc-ui";
import { ApiError, sendJson } from "@/lib/api/http";
import type {
  OnuInventoryResponse,
  OnuPhaseState,
  OltConsoleTarget,
} from "@/types/operations";

const PAGE_SIZES = [20, 50, 100] as const;
const ONU_PHASES: OnuPhaseState[] = ["working", "DyingGasp", "LOS", "syncMib"];
const KNOWN_ONU_PHASES = new Set<string>(ONU_PHASES);

type PageSize = (typeof PAGE_SIZES)[number];
type OnuStatusFilter = "" | "tidak-sehat" | OnuPhaseState;

const STATUS_OPTIONS: Array<{ value: OnuStatusFilter; label: string }> = [
  { value: "", label: "Semua status" },
  { value: "tidak-sehat", label: "Tidak sehat" },
  { value: "LOS", label: "LOS" },
  { value: "DyingGasp", label: "DyingGasp" },
  { value: "working", label: "working" },
  { value: "syncMib", label: "syncMib" },
];

function phaseTone(phase: OnuPhaseState) {
  if (phase === "working") return "positive" as const;
  if (phase === "LOS") return "danger" as const;
  if (phase === "DyingGasp") return "warning" as const;
  return "info" as const;
}

function phaseLabel(phase: OnuPhaseState) {
  return phase === "working" ? "Working" : phase;
}

function targetLabel(target: OltConsoleTarget) {
  const vendor = [target.vendor, target.model].filter(Boolean).join(" · ");
  return vendor ? `${target.name} · ${vendor}` : target.name;
}

function errorMessage(error: ApiError | Error) {
  return error instanceof ApiError ? error.message : "Daftar ONU tidak dapat dimuat.";
}

export default function OnuListPanel({
  targets,
  targetsLoading,
  targetsError,
}: {
  targets: OltConsoleTarget[];
  targetsLoading: boolean;
  targetsError: unknown;
}) {
  const readyTargets = targets.filter((target) => target.konsolSiap);
  const [selectedOltId, setSelectedOltId] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<OnuStatusFilter>("");
  const [pageSize, setPageSize] = useState<PageSize>(50);
  const [result, setResult] = useState<OnuInventoryResponse | null>(null);
  const [requestError, setRequestError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(false);
  const activeOltId = selectedOltId || readyTargets[0]?.id || "";
  const activeTarget = readyTargets.find((target) => target.id === activeOltId) ?? null;
  const unknownSummaryPhases = result
    ? Object.keys(result.ringkas).filter((phase) => !KNOWN_ONU_PHASES.has(phase)).sort((a, b) => a.localeCompare(b))
    : [];
  const summaryPhases = [...ONU_PHASES, ...unknownSummaryPhases] as OnuPhaseState[];

  async function loadPage(event?: FormEvent<HTMLFormElement>, requestedPage = 1) {
    event?.preventDefault();
    if (!activeOltId) return;

    setLoading(true);
    setRequestError(null);
    try {
      const data = await sendJson<OnuInventoryResponse>("POST", "/api/v1/devices/onu", {
        oltId: activeOltId,
        q: query.trim() || undefined,
        status: status || undefined,
        halaman: requestedPage,
        ukuran: pageSize,
      });
      setResult(data);
    } catch (cause) {
      setResult(null);
      setRequestError(
        cause instanceof ApiError || cause instanceof Error
          ? cause
          : new Error("Daftar ONU tidak dapat dimuat."),
      );
    } finally {
      setLoading(false);
    }
  }

  function clearResult() {
    setResult(null);
    setRequestError(null);
  }

  const refreshAction = result ? (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={() => void loadPage(undefined, result.halaman)}
      disabled={loading}
    >
      <RefreshCw aria-hidden="true" />
      Muat ulang
    </Button>
  ) : undefined;

  return (
    <NocPanel
      title="Daftar ONU per OLT"
      description="Daftar terurai dapat disaring, tetapi setiap permintaan tetap membuka sesi baca ke perangkat. Tidak ada pemanggilan otomatis."
      action={refreshAction}
    >
      {targetsLoading && <NocState kind="loading">Memuat pilihan OLT…</NocState>}
      {Boolean(targetsError) && <NocState kind="error">Daftar OLT tidak dapat dimuat.</NocState>}

      {!targetsLoading && !targetsError && readyTargets.length === 0 && (
        <NocState kind="empty">Belum ada OLT yang siap dibaca.</NocState>
      )}

      {!targetsLoading && !targetsError && readyTargets.length > 0 && (
        <>
          <form className="noc-onu-toolbar" onSubmit={(event) => void loadPage(event, 1)}>
            <label className="noc-onu-control">
              <span>Perangkat OLT</span>
              <select
                className="noc-field-select"
                value={activeOltId}
                onChange={(event) => {
                  setSelectedOltId(event.target.value);
                  clearResult();
                }}
                disabled={loading}
              >
                {readyTargets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {targetLabel(target)}
                  </option>
                ))}
              </select>
            </label>
            <label className="noc-onu-control noc-onu-search">
              <span>Cari indeks / port PON</span>
              <span className="noc-onu-input-wrap">
                <Search aria-hidden="true" />
                <Input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    clearResult();
                  }}
                  placeholder="Contoh: 1/2/3"
                  aria-label="Cari indeks atau port PON"
                  autoComplete="off"
                  disabled={loading}
                />
              </span>
            </label>
            <label className="noc-onu-control">
              <span>Status</span>
              <select
                className="noc-field-select"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as OnuStatusFilter);
                  clearResult();
                }}
                disabled={loading}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="noc-onu-control">
              <span>Baris</span>
              <select
                className="noc-field-select"
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value) as PageSize);
                  clearResult();
                }}
                disabled={loading}
              >
                {PAGE_SIZES.map((value) => (
                  <option key={value} value={value}>
                    {value} baris
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" disabled={!activeOltId || loading}>
              <Search aria-hidden="true" />
              {loading ? "Membaca…" : "Muat daftar ONU"}
            </Button>
          </form>

          {activeTarget && (
            <p className="noc-onu-target-note">
              <strong>{activeTarget.name}</strong> · Klik tombol untuk menjalankan permintaan POST baca ke perangkat.
            </p>
          )}

          {requestError && (
            <div className="noc-onu-error" role="alert">
              <NocState kind="error">{errorMessage(requestError)}</NocState>
              {requestError instanceof ApiError && requestError.status === 501 && (
                <p>
                  Perangkat ini memang tidak menyediakan perintah daftar ONU. Hasil tidak ditampilkan sebagai daftar kosong.
                </p>
              )}
            </div>
          )}

          {result && (
            <div className="noc-onu-result" aria-live="polite">
              <div className="noc-onu-result-heading">
                <div>
                  <strong>{result.olt.name}</strong>
                  <span>{result.olt.vendor ?? "Vendor belum diketahui"}</span>
                </div>
                <NocStatus label={result.perintah} tone="info" />
              </div>

              <div className="noc-onu-summary" aria-label="Ringkasan status ONU">
                {summaryPhases.map((phase) => (
                  <NocStatus
                    key={phase}
                    label={`${phaseLabel(phase)}: ${result.ringkas[phase] ?? 0}`}
                    tone={phaseTone(phase)}
                  />
                ))}
              </div>

              <div className="noc-onu-result-facts">
                <span>{result.totalTersaring} cocok dari {result.total} ONU</span>
                <span>Halaman {result.halaman} / {Math.max(result.halamanTerakhir, 1)} · {result.ukuran} baris</span>
              </div>

              {result.takTerurai.length > 0 && (
                <div className="noc-onu-warning" role="status">
                  <AlertTriangle aria-hidden="true" />
                  <div>
                    <strong>{result.takTerurai.length} baris ONU tidak dapat diurai</strong>
                    <p>Baris mentah tetap ditampilkan sebagai peringatan agar daftar tidak terlihat lengkap secara keliru.</p>
                    <pre>{result.takTerurai.join("\n")}</pre>
                  </div>
                </div>
              )}

              {result.baris.length === 0 ? (
                <NocState kind="empty">Tidak ada ONU yang cocok dengan saringan ini.</NocState>
              ) : (
                <div className="noc-mini-table-wrap">
                  <table className="noc-mini-table noc-onu-table">
                    <thead>
                      <tr>
                        <th>Indeks</th>
                        <th>PON port</th>
                        <th>ONU ID</th>
                        <th>Admin</th>
                        <th>OMCC</th>
                        <th>Phase</th>
                        <th>Keterangan</th>
                        <th>Kesehatan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.baris.map((row) => (
                        <tr key={row.indeks}>
                          <td className="is-mono is-strong">{row.indeks}</td>
                          <td className="is-mono">{row.ponPort}</td>
                          <td>{row.onuId}</td>
                          <td>{row.adminState}</td>
                          <td>{row.omccState}</td>
                          <td><NocStatus label={phaseLabel(row.phaseState)} tone={phaseTone(row.phaseState)} /></td>
                          <td>{row.keterangan || "—"}</td>
                          <td><NocStatus label={row.sehat ? "Sehat" : "Tidak sehat"} tone={row.sehat ? "positive" : "danger"} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {result.totalTersaring > 0 && (
                <div className="noc-onu-pagination">
                  <span>Data hasil saringan dari seluruh ONU di OLT ini.</span>
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      onClick={() => void loadPage(undefined, Math.max(1, result.halaman - 1))}
                      disabled={loading || result.halaman <= 1}
                      aria-label="Halaman ONU sebelumnya"
                    >
                      <ChevronLeft aria-hidden="true" />
                    </Button>
                    <strong>Halaman {result.halaman} / {Math.max(result.halamanTerakhir, 1)}</strong>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      onClick={() => void loadPage(undefined, Math.min(result.halamanTerakhir, result.halaman + 1))}
                      disabled={loading || result.halaman >= result.halamanTerakhir}
                      aria-label="Halaman ONU berikutnya"
                    >
                      <ChevronRight aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </NocPanel>
  );
}
