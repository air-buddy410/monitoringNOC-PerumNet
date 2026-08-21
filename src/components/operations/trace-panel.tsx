"use client";

import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { NocMetric, NocPanel, NocState, NocStatus } from "@/components/noc-ui";
import { ApiError, getJson } from "@/lib/api/http";
import { formatPanjang } from "@/lib/noc-format";
import type { TracePath, TracePathStatus, TraceResponse, TraceStep } from "@/types/operations";

function pathTone(status: TracePathStatus) {
  if (status === "LENGKAP") return "positive" as const;
  if (status === "TERPOTONG") return "warning" as const;
  if (status === "UJUNG_JALUR") return "info" as const;
  return "danger" as const;
}

function detailText(step: TraceStep, key: string) {
  const value = step.detail[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function detailBoolean(step: TraceStep, key: string) {
  return step.detail[key] === true;
}

function Stepper({ path }: { path: TracePath }) {
  return (
    <div className="noc-trace-stepper">
      {path.langkah.map((step, index) => (
        <div key={`${step.urutan}-${step.jenis}-${step.label}`} className={`noc-trace-step is-${step.jenis.toLowerCase()}`}>
          <span className="noc-trace-marker">{index + 1}</span>
          <div className="noc-trace-step-copy">
            <div className="noc-trace-step-heading"><NocStatus label={step.jenis.replace("_", " ")} tone={step.jenis === "SPLITTER" ? "info" : "neutral"} /><strong>{step.label}</strong></div>
            <div className="noc-trace-step-meta">
              {step.jenis === "CORE" && <span>{detailText(step, "purpose") ?? "Peruntukan belum diisi"}{detailText(step, "color") ? ` · ${detailText(step, "color")}` : ""}</span>}
              {step.jenis === "CORE" && <span>{formatPanjang(typeof step.detail.panjangM === "number" ? step.detail.panjangM : null)}</span>}
              {step.jenis === "SILANGAN" && <span>{detailBoolean(step, "silang") ? "Nomor core berubah" : "Nomor core tetap"}</span>}
              {step.jenis === "SILANGAN" && detailText(step, "estimasiRugiDb") && <span>Estimasi rugi {detailText(step, "estimasiRugiDb")} dB</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SegmentTable({ path }: { path: TracePath }) {
  const segments = path.langkah.filter((step) => step.jenis === "CORE");
  return (
    <div className="noc-trace-segment-wrap">
      {segments.length === 0 ? <NocState kind="empty">Belum ada segmen kabel pada jalur ini.</NocState> : <table className="noc-mini-table noc-trace-segment-table"><thead><tr><th>Segmen</th><th>Core</th><th>Warna</th><th>Peruntukan</th><th>Panjang</th></tr></thead><tbody>{segments.map((step) => <tr key={`${step.urutan}-${step.label}`}><td>{detailText(step, "segmentCode") ?? step.label}</td><td>Core {detailText(step, "coreNumber") ?? "—"}</td><td>{detailText(step, "color") ?? "—"}</td><td>{detailText(step, "purpose") ?? "—"}</td><td>{formatPanjang(typeof step.detail.panjangM === "number" ? step.detail.panjangM : null)}</td></tr>)}<tr className="is-total"><td colSpan={4}><strong>Total jalur</strong></td><td><strong>{formatPanjang(path.ringkas.panjangM, path.ringkas.panjangLengkap)}</strong></td></tr></tbody></table>}
    </div>
  );
}

function Crossings({ path }: { path: TracePath }) {
  const crossings = path.langkah.filter((step) => step.jenis === "SILANGAN");
  return (
    <div className="noc-trace-crossings">
      {crossings.length === 0 ? <NocState kind="empty">Tidak ada silangan core pada jalur ini.</NocState> : crossings.map((step) => <div className="noc-trace-crossing" key={`${step.urutan}-${step.label}`}><div><strong>{step.label}</strong><span>{detailText(step, "closureCode") ?? "Closure"}</span></div><NocStatus label={detailBoolean(step, "silang") ? "Nomor berubah" : "Nomor tetap"} tone={detailBoolean(step, "silang") ? "warning" : "neutral"} /><small>{detailText(step, "estimasiRugiDb") ? `Estimasi rugi ${detailText(step, "estimasiRugiDb")} dB${detailBoolean(step, "rugiDariModel") ? " · model" : ""}` : "Estimasi rugi: —"}</small></div>)}
    </div>
  );
}

export function TracePanel({ source, focus = "jalur" }: { source: { kind: "otbPort" | "odpPort" | "core"; id: string; label: string; end?: "A" | "B" } | null; focus?: "jalur" | "core" }) {
  const query = source ? `?dari=${encodeURIComponent(source.kind)}&id=${encodeURIComponent(source.id)}${source.kind === "core" && source.end ? `&ujung=${source.end}` : ""}` : null;
  const { data, error, isLoading, mutate } = useSWR<TraceResponse>(query ? `/api/v1/ftth/trace${query}` : null, getJson<TraceResponse>, { revalidateOnFocus: false });
  const sourceKey = source ? `${source.kind}:${source.id}:${source.end ?? ""}` : "none";
  const [branchSelection, setBranchSelection] = useState({ key: "", index: 0 });
  const branchIndex = branchSelection.key === sourceKey ? branchSelection.index : 0;
  const branch = useMemo(() => data?.jalur[Math.min(branchIndex, Math.max((data?.jalur.length ?? 1) - 1, 0))] ?? null, [branchIndex, data?.jalur]);
  const output = branch?.langkah[branch.langkah.length - 1] ?? null;

  if (!source) return <NocState kind="empty">Pilih port OTB dari Inventori Tray untuk memulai trace jalur.</NocState>;
  if (isLoading) return <NocState kind="loading">Menelusuri jalur dari {source.label}…</NocState>;
  if (error || !data) return <NocState kind="error">{error instanceof ApiError ? error.message : "Trace jalur tidak dapat dimuat."}</NocState>;
  if (data.jalur.length === 0) return <NocState kind="empty">Trace belum menghasilkan jalur dari {source.label}.</NocState>;
  if (!branch) return <NocState kind="empty">Trace belum menghasilkan cabang jalur.</NocState>;

  return (
    <div className={`noc-trace-view is-${focus}`}>
      <div className="noc-trace-source"><div><span>Titik awal</span><strong>{data.mulai.label}</strong></div><Button type="button" size="sm" variant="ghost" onClick={() => { void mutate(); }} aria-label="Muat ulang trace"><RefreshCw aria-hidden="true" /></Button></div>
      <div className="noc-trace-overview"><NocMetric label="Cabang" value={data.ringkas.total} note={`${data.ringkas.lengkap} lengkap · ${data.ringkas.bermasalah} bermasalah`} /><NocMetric label="Jalur aktif" value={branch.ringkas.hop} note="hop" /><NocMetric label="Panjang" value={formatPanjang(branch.ringkas.panjangM, branch.ringkas.panjangLengkap)} note="meter / estimasi server" /><NocMetric label="Estimasi loss" value={`${branch.ringkas.estimasiLossDb} dB`} note={`${branch.ringkas.sambunganPakaiModel} sambungan memakai model`} /></div>
      {data.jalur.length > 1 && <div className="noc-trace-branches" role="tablist" aria-label="Cabang jalur trace">{data.jalur.map((path, index) => <button key={`${path.status}-${index}`} type="button" role="tab" aria-selected={index === branchIndex} className={`noc-trace-branch ${index === branchIndex ? "is-selected" : ""}`} onClick={() => setBranchSelection({ key: sourceKey, index })}><strong>Jalur {index + 1}</strong><NocStatus label={path.status} tone={pathTone(path.status)} /></button>)}</div>}
      <div className="noc-trace-status"><NocStatus label={branch.status} tone={pathTone(branch.status)} />{branch.diagnosis && <p>{branch.diagnosis}</p>}{branch.ringkas.segmenBerulang > 0 && <p className="noc-trace-note">Jalur ini melewati {branch.ringkas.segmenBerulang} segmen kabel berulang. Panjangnya dihitung sesuai lintasan cahaya.</p>}{data.ringkas.terpotong && <p>Jumlah cabang dipotong oleh batas aman mesin trace.</p>}</div>
      <div className="noc-trace-grid">
        <NocPanel title="Jalur Singkat Core" description="Urutan hop berasal dari mesin trace; splitter dan silangan tidak disamakan."><Stepper path={branch} /></NocPanel>
        <NocPanel title="Informasi Output (Akhir Jalur)" description="Titik terakhir yang berhasil ditelusuri.">{output ? <div className="noc-trace-output"><NocStatus label={output.jenis.replace("_", " ")} tone={output.jenis === "PORT_ODP" ? "positive" : "info"} /><strong>{output.label}</strong><small>{output.jenis === "PORT_ODP" ? "Ujung distribusi" : "Jalur berhenti sebelum port output"}</small></div> : <NocState kind="empty">Tidak ada output jalur.</NocState>}</NocPanel>
      </div>
      <NocPanel title="Rincian Panjang Jalur" description="Panjang yang belum diukur tidak dijumlahkan sebagai nol."><SegmentTable path={branch} /></NocPanel>
      <NocPanel title="Silangan Core" description="Estimasi rugi adalah model, bukan hasil ukur OTDR."><Crossings path={branch} /></NocPanel>
    </div>
  );
}
