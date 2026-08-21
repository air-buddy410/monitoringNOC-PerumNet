"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Cable, Check, RefreshCw } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NocPageHeader, NocPanel, NocState, NocStatus } from "@/components/noc-ui";
import { useSession } from "@/hooks/use-session";
import { ApiError, getJson, sendJson } from "@/lib/api/http";
import { formatDateTime, formatPanjang } from "@/lib/noc-format";
import type {
  FiberCableCategory,
  FiberCableDetail,
  FiberCableStatus,
  FiberCableSummary,
  FiberCore,
  FiberCorePurpose,
  FiberCoreStatus,
  FiberCablesResponse,
  FiberTerminationHistory,
  FiberTerminationHistoryResponse,
  FiberType,
} from "@/types/operations";

const categoryLabels: Record<FiberCableCategory, string> = {
  backbone: "Backbone",
  feeder: "Feeder",
  distribution: "Distribution",
  dropcore: "Drop core",
  interconnect: "Interconnect",
  lain: "Lain",
};

const fiberTypeLabels: Record<FiberType, string> = {
  "G.652D": "G.652D",
  "G.657A1": "G.657A1",
  "G.657A2": "G.657A2",
  lain: "Lain",
};

const cableStatusLabels: Record<FiberCableStatus, string> = {
  aktif: "Aktif",
  nonaktif: "Nonaktif",
};

const purposeLabels: Record<FiberCorePurpose, string> = {
  feeder: "Feeder",
  distribution: "Distribution",
};

const coreStatusLabels: Record<FiberCoreStatus, string> = {
  baik: "Baik",
  rusak: "Rusak",
  nonaktif: "Nonaktif",
};

const categoryOptions: FiberCableCategory[] = ["backbone", "feeder", "distribution", "dropcore", "interconnect", "lain"];
const fiberTypeOptions: FiberType[] = ["G.652D", "G.657A1", "G.657A2", "lain"];

function cableTone(status: FiberCableStatus) {
  return status === "aktif" ? ("positive" as const) : ("neutral" as const);
}

function coreTone(status: FiberCoreStatus) {
  if (status === "rusak") return "danger" as const;
  if (status === "nonaktif") return "neutral" as const;
  return "positive" as const;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

type FiberHistoryKey = readonly [string, ...string[]];

async function fetchTerminationHistories([, ...coreIds]: FiberHistoryKey) {
  return Promise.all(coreIds.map((coreId) => getJson<FiberTerminationHistoryResponse>(`/api/v1/ftth/cores/${encodeURIComponent(coreId)}/terminations`)));
}

interface FiberHistoryRow extends FiberTerminationHistory {
  cableCode: string;
  coreNumber: number;
}

function FiberTerminationHistoryList({ cable }: { cable: FiberCableDetail }) {
  const coreIds = cable.cores.map((core) => core.id);
  const historyKey = coreIds.length ? (["fiber-termination-history", ...coreIds] as const) : null;
  const { data, error, isLoading } = useSWR<FiberTerminationHistoryResponse[]>(
    historyKey,
    fetchTerminationHistories,
    { revalidateOnFocus: false },
  );
  const rows = useMemo<FiberHistoryRow[]>(
    () => (data ?? []).flatMap((response, index) => {
      const core = cable.cores[index];
      if (!core) return [];
      return response.terminations.map((termination) => ({
        ...termination,
        cableCode: cable.code,
        coreNumber: core.coreNumber,
      }));
    }).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    [cable.code, cable.cores, data],
  );

  if (isLoading) return <NocState kind="loading">Memuat riwayat terminasi seluruh core…</NocState>;
  if (error) return <NocState kind="error">{error instanceof ApiError ? error.message : "Riwayat terminasi tidak dapat dimuat."}</NocState>;
  if (rows.length === 0) return <NocState kind="empty">Belum ada riwayat terminasi pada kabel ini.</NocState>;

  return (
    <div className="noc-fiber-history-list">
      {rows.map((row) => (
        <article className={`noc-fiber-history-card ${row.aktif ? "is-active" : "is-released"}`} key={row.id}>
          <div className="noc-fiber-history-heading">
            <div>
              <strong>{row.cableCode} · Core {row.coreNumber} · Ujung {row.coreEnd}</strong>
              <span>Dibuat {formatDateTime(row.createdAt)}</span>
            </div>
            <NocStatus label={row.aktif ? "Aktif" : "Dilepas"} tone={row.aktif ? "positive" : "warning"} />
          </div>
          <div className="noc-fiber-history-facts">
            <div><span>Sasaran</span><strong>{row.sasaran.label}</strong></div>
            <div><span>Alasan</span><strong>{row.reason}</strong></div>
          </div>
          {!row.aktif && <p className="noc-fiber-history-release">Dilepas {row.deactivatedAt ? formatDateTime(row.deactivatedAt) : "tanpa waktu"} · {row.deactivatedReason ?? "Alasan pelepasan tidak diisi"}</p>}
        </article>
      ))}
    </div>
  );
}

function CableSummaryRow({ cable }: { cable: FiberCableSummary }) {
  return (
    <Link className="noc-fiber-list-item" href={`/ftth/cables/${encodeURIComponent(cable.id)}`}>
      <span className="noc-fiber-summary-icon" aria-hidden="true"><Cable /></span>
      <span className="noc-fiber-summary-copy">
        <strong>{cable.code}</strong>
        <span>{cable.name ?? "Tanpa nama kabel"}</span>
        <small>{categoryLabels[cable.category]} · {cable.fiberType}</small>
      </span>
      <span className="noc-fiber-summary-counts">
        <span><strong>{cable.coreTerpasang}/{cable.coreCount}</strong><small>core</small></span>
        <span><strong>{cable.coreFeeder}</strong><small>feeder</small></span>
        <span><strong>{cable.coreDistribution}</strong><small>dist.</small></span>
      </span>
      <span className="noc-fiber-summary-action" aria-hidden="true"><NocStatus label={cableStatusLabels[cable.status]} tone={cableTone(cable.status)} /><ArrowRight /></span>
    </Link>
  );
}

interface CableFormState {
  code: string;
  name: string;
  category: FiberCableCategory;
  fiberType: FiberType;
  coreCount: string;
  lengthM: string;
  purpose: "" | FiberCorePurpose;
  notes: string;
}

const initialCableForm: CableFormState = {
  code: "",
  name: "",
  category: "feeder",
  fiberType: "G.652D",
  coreCount: "24",
  lengthM: "",
  purpose: "feeder",
  notes: "",
};

function CableCreateForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [form, setForm] = useState<CableFormState>(initialCableForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await sendJson("POST", "/api/v1/ftth/cables", {
        code: form.code.trim(),
        name: form.name.trim() || null,
        category: form.category,
        fiberType: form.fiberType,
        coreCount: Number(form.coreCount),
        lengthM: form.lengthM.trim() === "" ? null : Number(form.lengthM),
        purpose: form.purpose || undefined,
        notes: form.notes.trim() || null,
      });
      setForm(initialCableForm);
      await onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Kabel gagal dibuat.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="noc-feature-form" onSubmit={submit}>
      <div className="noc-form-grid is-two">
        <div className="noc-field"><label htmlFor="cable-code">Kode kabel</label><Input id="cable-code" required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="KBL-FDR-01" /></div>
        <div className="noc-field"><label htmlFor="cable-name">Nama kabel <span>(opsional)</span></label><Input id="cable-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Feeder POP → RK Seraya" /></div>
        <div className="noc-field"><label htmlFor="cable-category">Kategori</label><select id="cable-category" className="noc-field-select" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as FiberCableCategory })}>{categoryOptions.map((value) => <option key={value} value={value}>{categoryLabels[value]}</option>)}</select></div>
        <div className="noc-field"><label htmlFor="cable-fiber-type">Jenis serat</label><select id="cable-fiber-type" className="noc-field-select" value={form.fiberType} onChange={(event) => setForm({ ...form, fiberType: event.target.value as FiberType })}>{fiberTypeOptions.map((value) => <option key={value} value={value}>{fiberTypeLabels[value]}</option>)}</select></div>
        <div className="noc-field"><label htmlFor="cable-core-count">Jumlah core</label><Input id="cable-core-count" required type="number" min={1} max={288} value={form.coreCount} onChange={(event) => setForm({ ...form, coreCount: event.target.value })} /></div>
        <div className="noc-field"><label htmlFor="cable-length">Panjang (meter) <span>(opsional)</span></label><Input id="cable-length" type="number" min={0} value={form.lengthM} onChange={(event) => setForm({ ...form, lengthM: event.target.value })} placeholder="3250" /></div>
        <div className="noc-field"><label htmlFor="cable-purpose">Peruntukan seluruh core</label><select id="cable-purpose" className="noc-field-select" value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value as "" | FiberCorePurpose })}><option value="">Ikuti kategori</option><option value="feeder">Feeder</option><option value="distribution">Distribution</option></select></div>
      </div>
      <div className="noc-field"><label htmlFor="cable-notes">Catatan <span>(opsional)</span></label><Input id="cable-notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Informasi bentangan atau pekerjaan lapangan" /></div>
      {error && <NocState kind="error">{error}</NocState>}
      <Button type="submit" disabled={saving}>{saving ? "Menyimpan…" : "Buat kabel dan core"}</Button>
    </form>
  );
}

export function FiberCableDirectoryPage() {
  const { session } = useSession();
  const canManage = session?.user.role === "admin" || session?.user.role === "noc";
  const { data, error, isLoading, mutate } = useSWR<FiberCablesResponse>(
    "/api/v1/ftth/cables",
    getJson<FiberCablesResponse>,
    { revalidateOnFocus: false },
  );
  const cables = data?.cables ?? [];

  return (
    <main className="noc-page noc-feature-page">
      <NocPageHeader title="FTTH / Kabel" description="Catat bentangan kabel dan seluruh core yang menjadi jalur feeder atau distribusi." action={<div className="noc-feature-header-actions"><NocStatus label={`${cables.length} kabel`} tone="info" /><Button type="button" size="sm" variant="ghost" onClick={() => mutate()} aria-label="Muat ulang daftar kabel"><RefreshCw aria-hidden="true" /></Button></div>} />
      <div className="noc-feature-grid is-two-column">
        <NocPanel title="Tambah kabel" description="Pembuatan kabel menyiapkan seluruh core dalam satu transaksi.">
          {canManage ? <CableCreateForm onCreated={async () => { await mutate(); }} /> : <NocState kind="empty">Pembuatan kabel memerlukan peran admin atau NOC.</NocState>}
        </NocPanel>
        <NocPanel title="Daftar kabel" description="Panjang kosong berarti kabel belum diukur, bukan nol meter.">
          {isLoading && <NocState kind="loading">Memuat daftar kabel…</NocState>}
          {error && <NocState kind="error">{error instanceof ApiError ? error.message : "Daftar kabel tidak dapat dimuat."}</NocState>}
          {!isLoading && !error && cables.length === 0 && <NocState kind="empty">Belum ada kabel terdaftar.</NocState>}
          {cables.length > 0 && <div className="noc-fiber-list">{cables.map((cable) => <CableSummaryRow key={cable.id} cable={cable} />)}</div>}
        </NocPanel>
      </div>
    </main>
  );
}

function CoreTable({ cores }: { cores: FiberCore[] }) {
  return (
    <div className="noc-mini-table-wrap noc-fiber-table-wrap">
      <table className="noc-mini-table noc-fiber-table">
        <thead><tr><th>Core</th><th>Warna dari server</th><th>Peruntukan</th><th>Status</th><th>Ujung terpakai</th><th>Label / catatan</th></tr></thead>
        <tbody>{cores.map((core) => (
          <tr key={core.id}>
            <td><div className="noc-table-primary"><strong>Core {core.coreNumber}</strong><small>{core.tubeNumber === null ? "Tanpa tube" : `Tube ${core.tubeNumber}`}</small></div></td>
            <td><span className="noc-fiber-color"><i style={{ backgroundColor: core.color ?? "#b8c6c3" }} />{core.color ?? "Belum diisi"}</span></td>
            <td><NocStatus label={purposeLabels[core.purpose]} tone="info" /></td>
            <td><NocStatus label={coreStatusLabels[core.status]} tone={coreTone(core.status)} /></td>
            <td className="noc-fiber-ends">{core.ujungTerpakai.length > 0 ? core.ujungTerpakai.map((end) => <span key={end}>Ujung {end}</span>) : <small>Belum terterminasi</small>}</td>
            <td><div className="noc-fiber-core-note"><strong>{core.label ?? "Tanpa label"}</strong><small>{core.notes ?? "Tanpa catatan"}</small></div></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function FiberCableDetailPage({ cableId }: { cableId: string }) {
  const encodedCableId = encodeURIComponent(cableId);
  const { data: cable, error, isLoading, mutate } = useSWR<FiberCableDetail>(
    `/api/v1/ftth/cables/${encodedCableId}`,
    getJson<FiberCableDetail>,
    { revalidateOnFocus: false },
  );

  if (isLoading) return <main className="noc-page noc-feature-page"><NocState kind="loading">Memuat detail kabel…</NocState></main>;
  if (error || !cable) {
    return <main className="noc-page noc-feature-page"><Link className="noc-otb-back" href="/ftth/cables"><ArrowLeft aria-hidden="true" /> Kembali ke daftar kabel</Link><NocState kind="error">{error instanceof ApiError ? error.message : "Detail kabel tidak dapat dimuat."}</NocState></main>;
  }

  return (
    <main className="noc-page noc-feature-page">
      <div className="noc-fiber-heading"><Link className="noc-otb-back" href="/ftth/cables"><ArrowLeft aria-hidden="true" /> Kembali ke daftar kabel</Link><div className="noc-otb-heading-main"><div><div className="noc-otb-title-line"><span>Detail Kabel</span><NocStatus label={cableStatusLabels[cable.status]} tone={cableTone(cable.status)} /></div><h1>{cable.code}</h1><p>{cable.name ?? "Tanpa nama kabel"}</p></div><Button type="button" size="sm" variant="ghost" onClick={() => { void mutate(); }} aria-label="Muat ulang detail kabel"><RefreshCw aria-hidden="true" /></Button></div></div>
      <div className="noc-fiber-facts"><div><span>Kategori</span><strong>{categoryLabels[cable.category]}</strong></div><div><span>Jenis serat</span><strong>{cable.fiberType}</strong></div><div><span>Panjang</span><strong>{formatPanjang(cable.lengthM)}</strong></div><div><span>Jumlah core</span><strong>{cable.cores.length}/{cable.coreCount}</strong></div></div>
      <NocPanel title="Matriks core" description="Nomor, warna, peruntukan, dan status berasal dari inventori server."><CoreTable cores={cable.cores} /></NocPanel>
      <NocPanel title="Riwayat terminasi" description="Jejak terminasi yang dilepas harus tetap dapat dibaca saat investigasi."
        action={<NocStatus label="Termasuk yang dilepas" tone="info" />}>
        <FiberTerminationHistoryList cable={cable} />
      </NocPanel>
      <p className="noc-source-note"><Check aria-hidden="true" /> Dibuat pada {formatDate(cable.createdAt)}. Identitas pelanggan tidak ditampilkan.</p>
    </main>
  );
}

export default FiberCableDirectoryPage;
