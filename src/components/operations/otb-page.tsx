"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Box, Check, Link2, RefreshCw, Route } from "lucide-react";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NocPageHeader, NocPanel, NocState, NocStatus } from "@/components/noc-ui";
import { OtbTerminationPanel } from "@/components/operations/fiber-termination";
import { TracePanel } from "@/components/operations/trace-panel";
import { useSession } from "@/hooks/use-session";
import { ApiError, getJson, sendJson } from "@/lib/api/http";
import type {
  OtbDetail,
  OtbPort,
  OtbPortStatus,
  OtbPortsResponse,
  OtbResponse,
  OtbStatus,
  OtbSummary,
  OtbTray,
} from "@/types/operations";

type OtbTab = "jalur" | "core" | "inventori" | "riwayat";

const otbStatusLabels: Record<OtbStatus, string> = {
  aktif: "Aktif",
  nonaktif: "Nonaktif",
};

const trayStatusLabels: Record<OtbTray["status"], string> = {
  terhubung: "Terhubung",
  sebagian: "Sebagian",
  kosong: "Kosong",
  nonaktif: "Nonaktif",
};

const portStatusLabels: Record<OtbPortStatus, string> = {
  kosong: "Kosong",
  terpakai: "Terpakai",
  dicadangkan: "Dicadangkan",
  rusak: "Rusak",
  nonaktif: "Nonaktif",
};

const tabs: Array<{ id: OtbTab; label: string }> = [
  { id: "jalur", label: "Peta Jalur" },
  { id: "core", label: "Detail Core" },
  { id: "inventori", label: "Inventori Tray" },
  { id: "riwayat", label: "Riwayat (History)" },
];

function otbTone(status: OtbStatus) {
  return status === "aktif" ? ("positive" as const) : ("neutral" as const);
}

function trayTone(status: OtbTray["status"]) {
  if (status === "terhubung") return "positive" as const;
  if (status === "sebagian") return "warning" as const;
  if (status === "nonaktif") return "neutral" as const;
  return "info" as const;
}

function portTone(status: OtbPortStatus) {
  if (status === "terpakai") return "positive" as const;
  if (status === "dicadangkan") return "warning" as const;
  if (status === "rusak") return "danger" as const;
  if (status === "nonaktif") return "neutral" as const;
  return "info" as const;
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatCount(value: number) {
  return new Intl.NumberFormat("id-ID").format(value);
}

function OtbSummaryRow({ otb }: { otb: OtbSummary }) {
  return (
    <Link className="noc-otb-list-item" href={`/ftth/otb/${encodeURIComponent(otb.id)}`}>
      <span className="noc-otb-summary-icon" aria-hidden="true">
        <Box />
      </span>
      <span className="noc-otb-summary-copy">
        <strong>{otb.code}</strong>
        <span>{otb.name}</span>
        <small>{otb.siteName ?? "Situs belum ditetapkan"}</small>
      </span>
      <span className="noc-otb-summary-counts">
        <span><strong>{otb.trayCount}</strong><small>tray</small></span>
        <span><strong>{otb.usedPorts}/{otb.portCount}</strong><small>terpakai</small></span>
        <span><strong>{otb.brokenPorts}</strong><small>rusak</small></span>
      </span>
      <span className="noc-otb-summary-action" aria-hidden="true">
        <NocStatus label={otbStatusLabels[otb.status]} tone={otbTone(otb.status)} />
        <ArrowRight />
      </span>
    </Link>
  );
}

export function OtbDirectoryPage() {
  const router = useRouter();
  const { data, error, isLoading, mutate } = useSWR<OtbResponse>(
    "/api/v1/ftth/otb",
    getJson<OtbResponse>,
    { revalidateOnFocus: false },
  );
  const [selectedId, setSelectedId] = useState("");
  const otb = data?.otb ?? [];

  function openSelectedOtb() {
    if (selectedId) router.push(`/ftth/otb/${encodeURIComponent(selectedId)}`);
  }

  return (
    <main className="noc-page noc-feature-page">
      <NocPageHeader
        title="FTTH / OTB"
        description="Pantau tray dan inventori port OTB dengan nomor port yang mengikuti data jaringan."
        action={
          <div className="noc-feature-header-actions">
            <NocStatus label={`${otb.length} OTB`} tone="info" />
            <Button type="button" size="sm" variant="ghost" onClick={() => mutate()} aria-label="Muat ulang daftar OTB">
              <RefreshCw aria-hidden="true" />
            </Button>
          </div>
        }
      />

      <div className="noc-feature-grid is-two-column">
        <NocPanel title="Pilih OTB" description="Buka detail untuk memilih tray dan melihat inventori port.">
          {isLoading && <NocState kind="loading">Memuat daftar OTB…</NocState>}
          {error && <NocState kind="error">{error instanceof ApiError ? error.message : "Daftar OTB tidak dapat dimuat."}</NocState>}
          {!isLoading && !error && otb.length === 0 && <NocState kind="empty">Belum ada OTB terdaftar.</NocState>}
          {otb.length > 0 && (
            <div className="noc-feature-form">
              <div className="noc-field">
                <label htmlFor="otb-picker">OTB</label>
                <select id="otb-picker" className="noc-field-select" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                  <option value="">Pilih OTB dari daftar</option>
                  {otb.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
                </select>
              </div>
              <Button type="button" onClick={openSelectedOtb} disabled={!selectedId}>
                Buka detail <ArrowRight aria-hidden="true" />
              </Button>
            </div>
          )}
        </NocPanel>

        <NocPanel title="Inventori OTB" description="Ringkasan kapasitas berasal dari tray dan port yang tersimpan di server.">
          {isLoading && <NocState kind="loading">Memuat ringkasan…</NocState>}
          {error && <NocState kind="error">Ringkasan OTB tidak dapat dimuat.</NocState>}
          {!isLoading && !error && otb.length === 0 && <NocState kind="empty">Ringkasan akan muncul setelah OTB dibuat.</NocState>}
          {otb.length > 0 && <div className="noc-otb-list">{otb.map((item) => <OtbSummaryRow key={item.id} otb={item} />)}</div>}
        </NocPanel>
      </div>
    </main>
  );
}

function OtbPortRow({
  otbId,
  trayNumber,
  port,
  canManage,
  canTerminate,
  onSaved,
  onTrace,
  onTerminate,
}: {
  otbId: string;
  trayNumber: number;
  port: OtbPort;
  canManage: boolean;
  canTerminate: boolean;
  onSaved: () => Promise<void>;
  onTrace: (port: OtbPort) => void;
  onTerminate: (port: OtbPort) => void;
}) {
  const [status, setStatus] = useState<OtbPortStatus>(port.status);
  const [externalServiceId, setExternalServiceId] = useState(port.externalServiceId ?? "");
  const [notes, setNotes] = useState(port.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await sendJson("PATCH", `/api/v1/ftth/otb/${encodeURIComponent(otbId)}/trays/${trayNumber}/ports`, {
        portNumberInTray: port.portNumberInTray,
        status,
        externalServiceId: externalServiceId.trim() || null,
        notes: notes.trim() || null,
      });
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Port gagal disimpan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td className="is-mono">P{String(port.portNumberInTray).padStart(2, "0")}</td>
      <td className="is-mono">Core {port.globalPortNumber}</td>
      <td>
        <select className="noc-field-select is-compact" value={status} onChange={(event) => setStatus(event.target.value as OtbPortStatus)} disabled={!canManage}>
          {Object.entries(portStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </td>
      <td><Input value={externalServiceId} onChange={(event) => setExternalServiceId(event.target.value)} placeholder="CRM/ALUS service ID" aria-label={`External service ID port ${port.portNumberInTray}`} disabled={!canManage} /></td>
      <td><Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Catatan" aria-label={`Catatan port ${port.portNumberInTray}`} disabled={!canManage} /></td>
      <td>
        <div className="noc-otb-port-action">
          <NocStatus label={portStatusLabels[status]} tone={portTone(status)} />
          {canManage && <Button type="button" size="sm" variant="outline" onClick={save} disabled={saving}>{saving ? "…" : <Check aria-label="Simpan port" />}</Button>}
          <Button type="button" size="sm" variant="ghost" onClick={() => onTrace(port)} aria-label={`Trace port ${port.portNumberInTray}`}><Route aria-hidden="true" /></Button>
          {canTerminate && status === "kosong" && <Button type="button" size="sm" variant="ghost" onClick={() => onTerminate(port)} aria-label={`Terminasi port ${port.portNumberInTray}`}><Link2 aria-hidden="true" /></Button>}
        </div>
        <small className="noc-otb-updated">{formatUpdatedAt(port.updatedAt)}</small>
        {error && <small className="noc-inline-error">{error}</small>}
      </td>
    </tr>
  );
}

function EmptyOtbTab({ tab }: { tab: "riwayat" }) {
  const messages: Record<"riwayat", string> = {
    riwayat: "Riwayat perubahan port belum tersedia pada kontrak endpoint OTB. Audit log tetap dikelola oleh backend.",
  };
  return <NocState kind="empty">{messages[tab]}</NocState>;
}

export function OtbDetailPage({ otbId }: { otbId: string }) {
  const router = useRouter();
  const { session } = useSession();
  const canManage = ["admin", "noc", "engineer"].includes(session?.user.role ?? "");
  const canTerminate = session?.user.role === "admin" || session?.user.role === "noc";
  const encodedOtbId = encodeURIComponent(otbId);
  const { data: listData } = useSWR<OtbResponse>(
    "/api/v1/ftth/otb",
    getJson<OtbResponse>,
    { revalidateOnFocus: false },
  );
  const { data: detail, error, isLoading, mutate: mutateDetail } = useSWR<OtbDetail>(
    `/api/v1/ftth/otb/${encodedOtbId}`,
    getJson<OtbDetail>,
    { revalidateOnFocus: false },
  );
  const [selectedTrayNumber, setSelectedTrayNumber] = useState<number | null>(null);
  const [tab, setTab] = useState<OtbTab>("inventori");
  const [traceSource, setTraceSource] = useState<{ kind: "otbPort"; id: string; label: string } | null>(null);
  const [terminationPort, setTerminationPort] = useState<OtbPort | null>(null);
  const trays = useMemo(() => detail?.trays ?? [], [detail?.trays]);
  const selectedTray = useMemo(
    () => trays.find((tray) => tray.trayNumber === selectedTrayNumber) ?? trays[0],
    [selectedTrayNumber, trays],
  );
  const trayPortsUrl = selectedTray
    ? `/api/v1/ftth/otb/${encodedOtbId}/trays/${selectedTray.trayNumber}/ports`
    : null;
  const { data: portsData, error: portsError, isLoading: portsLoading, mutate: mutatePorts } = useSWR<OtbPortsResponse>(
    trayPortsUrl,
    getJson<OtbPortsResponse>,
    { revalidateOnFocus: false },
  );
  const otbOptions = listData?.otb ?? [];
  const scPorts = trays.filter((tray) => tray.connectorType === "SC").reduce((total, tray) => total + tray.portCount, 0);
  const lcPorts = trays.filter((tray) => tray.connectorType === "LC").reduce((total, tray) => total + tray.portCount, 0);

  async function refreshInventory() {
    await Promise.all([mutatePorts(), mutateDetail()]);
  }

  function tracePort(port: OtbPort) {
    setTraceSource({ kind: "otbPort", id: port.id, label: `${detail?.code ?? "OTB"} · Tray ${selectedTray?.trayNumber ?? "—"} port ${port.portNumberInTray}` });
    setTab("jalur");
  }

  if (isLoading) {
    return <main className="noc-page noc-feature-page"><NocState kind="loading">Memuat detail OTB…</NocState></main>;
  }

  if (error || !detail) {
    return (
      <main className="noc-page noc-feature-page">
        <Link className="noc-otb-back" href="/ftth/otb"><ArrowLeft aria-hidden="true" /> Kembali ke daftar OTB</Link>
        <NocState kind="error">{error instanceof ApiError ? error.message : "Detail OTB tidak dapat dimuat."}</NocState>
      </main>
    );
  }

  return (
    <main className="noc-page noc-feature-page">
      <div className="noc-otb-heading">
        <Link className="noc-otb-back" href="/ftth/otb"><ArrowLeft aria-hidden="true" /> Kembali ke daftar OTB</Link>
        <div className="noc-otb-heading-main">
          <div>
            <div className="noc-otb-title-line"><span>Detail OTB</span><NocStatus label={otbStatusLabels[detail.status]} tone={otbTone(detail.status)} /></div>
            <h1>{detail.code}</h1>
            <p>{detail.name}{detail.siteName ? ` · ${detail.siteName}` : ""}</p>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={() => { void refreshInventory(); }} aria-label="Muat ulang detail OTB"><RefreshCw aria-hidden="true" /></Button>
        </div>
      </div>

      <section className="noc-otb-control-panel" aria-label="Kontrol OTB dan tray">
        <div className="noc-otb-control-grid">
          <div className="noc-otb-control">
            <label htmlFor="otb-detail-picker">Pilih OTB</label>
            <select id="otb-detail-picker" className="noc-field-select" value={detail.id} onChange={(event) => router.push(`/ftth/otb/${encodeURIComponent(event.target.value)}`)}>
              {otbOptions.length > 0 ? otbOptions.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>) : <option value={detail.id}>{detail.code} · {detail.name}</option>}
            </select>
          </div>

          <div className="noc-otb-tray-control">
            <div className="noc-otb-control-label"><span>Pilih Tray</span><small>{trays.length} tray terdaftar</small></div>
            {trays.length > 0 ? (
              <div className="noc-otb-tray-scroll" role="list">
                {trays.map((tray) => {
                  const isSelected = selectedTray?.trayNumber === tray.trayNumber;
                  return (
                    <button key={tray.id} type="button" className={`noc-otb-tray-button ${isSelected ? "is-selected" : ""}`} onClick={() => setSelectedTrayNumber(tray.trayNumber)} aria-pressed={isSelected}>
                      <span className="noc-otb-tray-number">{tray.trayNumber}</span>
                      <span className="noc-otb-tray-meta"><strong>{tray.label ?? `Tray ${tray.trayNumber}`}</strong><small>{tray.usedPorts}/{tray.portCount} terpakai</small></span>
                      <NocStatus label={trayStatusLabels[tray.status]} tone={trayTone(tray.status)} />
                    </button>
                  );
                })}
              </div>
            ) : <NocState kind="empty">OTB ini belum memiliki tray.</NocState>}
          </div>
        </div>

        <dl className="noc-otb-control-facts">
          <div className="noc-otb-fact"><dt>Type Tray</dt><dd>{selectedTray ? `Tray ${selectedTray.trayNumber}` : "—"}</dd></div>
          <div className="noc-otb-fact"><dt>Connector</dt><dd>{selectedTray?.connectorType ?? "—"}</dd></div>
          <div className="noc-otb-fact"><dt>Polish</dt><dd>{selectedTray?.polish ?? "—"}</dd></div>
          <div className="noc-otb-fact"><dt>Status Tray</dt><dd>{selectedTray ? <NocStatus label={trayStatusLabels[selectedTray.status]} tone={trayTone(selectedTray.status)} /> : "—"}</dd></div>
        </dl>
      </section>

      <div className="noc-otb-info-strip" aria-label="Ringkasan connector">
        <div className="noc-otb-info-item"><strong>SC</strong><span>{scPorts > 0 ? `${formatCount(scPorts)} port terdaftar` : "Belum ada tray SC"}</span></div>
        <div className="noc-otb-info-item"><strong>LC</strong><span>{lcPorts > 0 ? `${formatCount(lcPorts)} port terdaftar` : "Belum ada tray LC"}</span></div>
        <div className="noc-otb-info-item is-note"><span>Trace jalur membaca data kabel, core, closure, dan terminasi yang tersimpan di server.</span></div>
      </div>

      <div className="noc-otb-tabs" role="tablist" aria-label="Detail OTB">
        {tabs.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={`noc-otb-tab ${tab === item.id ? "is-selected" : ""}`} onClick={() => setTab(item.id)}>{item.label}</button>
        ))}
      </div>

      {tab === "jalur" && <NocPanel title="Peta Jalur" description="Pilih tombol Trace pada port OTB untuk menelusuri seluruh cabang jalurnya."><TracePanel source={traceSource} focus="jalur" /></NocPanel>}

      {tab === "core" && <NocPanel title="Detail Core" description="Rincian core, silangan, panjang, dan output mengikuti respons mesin trace."><TracePanel source={traceSource} focus="core" /></NocPanel>}

      {tab === "riwayat" && <NocPanel title="Riwayat (History)"><EmptyOtbTab tab="riwayat" /></NocPanel>}

      {tab === "inventori" && (
        <NocPanel
          className="noc-otb-inventory"
          title={selectedTray ? `Inventori Tray ${selectedTray.trayNumber}` : "Inventori Tray"}
          description={selectedTray ? `${selectedTray.connectorType}/${selectedTray.polish} · ${selectedTray.portCount} port · nomor core mengikuti urutan global OTB.` : "Pilih tray untuk melihat inventori port."}
          action={<Button type="button" size="sm" variant="ghost" onClick={() => { void mutatePorts(); }} aria-label="Muat ulang inventori tray"><RefreshCw aria-hidden="true" /></Button>}
        >
          {!canManage && <NocState kind="empty">Mode baca saja. Perubahan port memerlukan peran admin, NOC, atau engineer.</NocState>}
          {selectedTray && portsLoading && <NocState kind="loading">Memuat inventori port…</NocState>}
          {selectedTray && portsError && <NocState kind="error">{portsError instanceof ApiError ? portsError.message : "Inventori port tidak dapat dimuat."}</NocState>}
          {selectedTray && portsData && portsData.ports.length === 0 && <NocState kind="empty">Tray ini belum memiliki port.</NocState>}
          {terminationPort && canTerminate && <OtbTerminationPanel otbPortId={terminationPort.id} portLabel={`Tray ${selectedTray?.trayNumber ?? "—"} · Port ${terminationPort.portNumberInTray}`} onCancel={() => setTerminationPort(null)} onCompleted={async () => { await refreshInventory(); setTerminationPort(null); }} />}
          {selectedTray && portsData && portsData.ports.length > 0 && (
            <div className="noc-mini-table-wrap noc-otb-port-table-wrap">
              <table className="noc-mini-table noc-port-table noc-otb-port-table">
                <thead><tr><th>Port</th><th>Nomor Core</th><th>Status</th><th>External service ID</th><th>Catatan</th><th>Aksi</th></tr></thead>
                <tbody>{portsData.ports.map((port) => <OtbPortRow key={`${port.id}-${port.updatedAt}-${port.status}-${port.externalServiceId ?? ""}-${port.notes ?? ""}`} otbId={detail.id} trayNumber={selectedTray.trayNumber} port={port} canManage={canManage} canTerminate={canTerminate && detail.status === "aktif"} onSaved={refreshInventory} onTrace={tracePort} onTerminate={setTerminationPort} />)}</tbody>
              </table>
            </div>
          )}
        </NocPanel>
      )}
    </main>
  );
}

export default OtbDirectoryPage;
