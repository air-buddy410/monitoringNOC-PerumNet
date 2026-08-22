"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, GitBranch, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NocPageHeader, NocPanel, NocState, NocStatus } from "@/components/noc-ui";
import { useSession } from "@/hooks/use-session";
import { TopologyHistoryPanel } from "@/components/operations/topology-history";
import { ApiError, getJson, sendJson } from "@/lib/api/http";
import type {
  ClosureCommitResponse,
  ClosureDetailResponse,
  ClosurePreviewResponse,
  ClosureSplice,
  ClosureSpliceRow,
  ClosureStatus,
  ClosureSummary,
  ClosureType,
  ClosuresResponse,
  FiberCableDetail,
  FiberCablesResponse,
  FiberCorePurpose,
  NetworkSite,
  SitesResponse,
} from "@/types/operations";

const closureTypeLabels: Record<ClosureType, string> = {
  inline: "Inline",
  dome: "Dome",
  lain: "Lain",
};

const closureStatusLabels: Record<ClosureStatus, string> = {
  aktif: "Aktif",
  nonaktif: "Nonaktif",
};

function closureTone(status: ClosureStatus) {
  return status === "aktif" ? ("positive" as const) : ("neutral" as const);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function ClosureSummaryRow({ closure }: { closure: ClosureSummary }) {
  return (
    <Link className="noc-closure-list-item" href={`/ftth/closures/${encodeURIComponent(closure.id)}`}>
      <span className="noc-closure-summary-icon" aria-hidden="true"><GitBranch /></span>
      <span className="noc-closure-summary-copy"><strong>{closure.code}</strong><span>{closure.name ?? "Tanpa nama closure"}</span><small>{closure.siteName ?? (closure.latitude !== null && closure.longitude !== null ? `${closure.latitude}, ${closure.longitude}` : "Lokasi belum tersedia")}</small></span>
      <span className="noc-closure-summary-counts"><span><strong>{closure.silanganAktif}</strong><small>aktif</small></span><span><strong>{closure.silanganTotal}</strong><small>total</small></span></span>
      <span className="noc-closure-summary-action" aria-hidden="true"><NocStatus label={closureStatusLabels[closure.status]} tone={closureTone(closure.status)} /><ArrowRight /></span>
    </Link>
  );
}

interface ClosureFormState {
  code: string;
  name: string;
  siteId: string;
  latitude: string;
  longitude: string;
  type: ClosureType;
  notes: string;
}

const initialClosureForm: ClosureFormState = { code: "", name: "", siteId: "", latitude: "", longitude: "", type: "inline", notes: "" };

function ClosureCreateForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const { data: sitesData } = useSWR<SitesResponse>("/api/v1/sites", getJson<SitesResponse>, { revalidateOnFocus: false });
  const [form, setForm] = useState<ClosureFormState>(initialClosureForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sites = sitesData?.sites ?? [];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await sendJson("POST", "/api/v1/ftth/closures", {
        code: form.code.trim(),
        name: form.name.trim() || null,
        siteId: form.siteId || null,
        latitude: form.latitude.trim() === "" ? null : Number(form.latitude),
        longitude: form.longitude.trim() === "" ? null : Number(form.longitude),
        type: form.type,
        notes: form.notes.trim() || null,
      });
      setForm(initialClosureForm);
      await onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Closure gagal dibuat.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="noc-feature-form" onSubmit={submit}>
      <div className="noc-form-grid is-two">
        <div className="noc-field"><label htmlFor="closure-code">Kode closure</label><Input id="closure-code" required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="CL-01" /></div>
        <div className="noc-field"><label htmlFor="closure-name">Nama closure <span>(opsional)</span></label><Input id="closure-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Closure Simpang Seraya" /></div>
        <div className="noc-field"><label htmlFor="closure-type">Tipe</label><select id="closure-type" className="noc-field-select" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as ClosureType })}><option value="inline">Inline</option><option value="dome">Dome</option><option value="lain">Lain</option></select></div>
        <div className="noc-field"><label htmlFor="closure-site">Situs <span>(opsional jika ada koordinat)</span></label><select id="closure-site" className="noc-field-select" value={form.siteId} onChange={(event) => setForm({ ...form, siteId: event.target.value })}><option value="">Tanpa situs</option>{sites.map((site: NetworkSite) => <option key={site.id} value={site.id}>{site.code} · {site.name}</option>)}</select></div>
        <div className="noc-field"><label htmlFor="closure-latitude">Latitude <span>(opsional)</span></label><Input id="closure-latitude" inputMode="decimal" value={form.latitude} onChange={(event) => setForm({ ...form, latitude: event.target.value })} placeholder="-8.4521" /></div>
        <div className="noc-field"><label htmlFor="closure-longitude">Longitude <span>(opsional)</span></label><Input id="closure-longitude" inputMode="decimal" value={form.longitude} onChange={(event) => setForm({ ...form, longitude: event.target.value })} placeholder="115.6033" /></div>
      </div>
      <div className="noc-field"><label htmlFor="closure-notes">Catatan <span>(opsional)</span></label><Input id="closure-notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Lokasi atau informasi lapangan" /></div>
      {error && <NocState kind="error">{error}</NocState>}
      <Button type="submit" disabled={saving}>{saving ? "Menyimpan…" : "Buat closure"}</Button>
    </form>
  );
}

export function ClosureDirectoryPage() {
  const { session } = useSession();
  const canManage = session?.user.role === "admin" || session?.user.role === "noc";
  const { data, error, isLoading, mutate } = useSWR<ClosuresResponse>("/api/v1/ftth/closures", getJson<ClosuresResponse>, { revalidateOnFocus: false });
  const closures = data?.closures ?? [];

  return (
    <main className="noc-page noc-feature-page">
      <NocPageHeader title="FTTH / Closure" description="Kelola matriks silangan core dan jejak sambungan pada closure lapangan." action={<div className="noc-feature-header-actions"><NocStatus label={`${closures.length} closure`} tone="info" /><Button type="button" size="sm" variant="ghost" onClick={() => mutate()} aria-label="Muat ulang daftar closure"><RefreshCw aria-hidden="true" /></Button></div>} />
      <div className="noc-feature-grid is-two-column">
        <NocPanel title="Tambah closure" description="Closure tanpa situs wajib memiliki koordinat agar bisa ditemukan di lapangan.">
          {canManage ? <ClosureCreateForm onCreated={async () => { await mutate(); }} /> : <NocState kind="empty">Pembuatan closure memerlukan peran admin atau NOC.</NocState>}
        </NocPanel>
        <NocPanel title="Daftar closure" description="Jumlah aktif dan total mencakup sambungan yang sudah dilepas.">
          {isLoading && <NocState kind="loading">Memuat daftar closure…</NocState>}
          {error && <NocState kind="error">{error instanceof ApiError ? error.message : "Daftar closure tidak dapat dimuat."}</NocState>}
          {!isLoading && !error && closures.length === 0 && <NocState kind="empty">Belum ada closure terdaftar.</NocState>}
          {closures.length > 0 && <div className="noc-closure-list">{closures.map((closure) => <ClosureSummaryRow key={closure.id} closure={closure} />)}</div>}
        </NocPanel>
      </div>
    </main>
  );
}

interface CoreOption {
  id: string;
  cableCode: string;
  coreNumber: number;
  color: string | null;
  purpose: FiberCorePurpose;
  availableEnds: Array<"A" | "B">;
}

type CableDetailsKey = readonly [string, ...string[]];

async function fetchCableDetails([, ...ids]: CableDetailsKey) {
  return Promise.all(ids.map((id) => getJson<FiberCableDetail>(`/api/v1/ftth/cables/${encodeURIComponent(id)}`)));
}

function CoreSelect({ id, value, options, onChange }: { id: string; value: string; options: CoreOption[]; onChange: (value: string) => void }) {
  return <select id={id} className="noc-field-select" value={value} onChange={(event) => onChange(event.target.value)}><option value="">Pilih core</option>{options.map((core) => <option key={core.id} value={core.id}>{core.cableCode} · Core {core.coreNumber} · {core.color ?? "warna belum diisi"} · {core.purpose}</option>)}</select>;
}

interface SpliceDraft extends ClosureSpliceRow {
  rowId: string;
  estimatedLossText: string;
}

function newDraft(): SpliceDraft {
  return { rowId: crypto.randomUUID(), inputCoreId: "", inputCoreEnd: "A", outputCoreId: "", outputCoreEnd: "B", estimatedLossDb: null, estimatedLossText: "" };
}

function getAvailableEnds(options: CoreOption[], coreId: string) {
  return options.find((core) => core.id === coreId)?.availableEnds ?? ["A", "B"];
}

function SpliceDraftRow({ draft, options, index, onChange, onRemove }: { draft: SpliceDraft; options: CoreOption[]; index: number; onChange: (next: SpliceDraft) => void; onRemove: () => void }) {
  const inputEnds = getAvailableEnds(options, draft.inputCoreId);
  const outputEnds = getAvailableEnds(options, draft.outputCoreId);
  function update(field: keyof SpliceDraft, value: string) {
    const next = { ...draft, [field]: value } as SpliceDraft;
    if (field === "inputCoreId") next.inputCoreEnd = getAvailableEnds(options, value)[0] ?? "A";
    if (field === "outputCoreId") next.outputCoreEnd = getAvailableEnds(options, value)[0] ?? "A";
    if (field === "estimatedLossText") next.estimatedLossDb = value.trim() === "" ? null : Number(value);
    onChange(next);
  }
  return (
    <div className="noc-splice-draft-row">
      <div className="noc-splice-draft-number">{index + 1}</div>
      <div className="noc-field"><label htmlFor={`splice-input-${draft.rowId}`}>Core masuk</label><CoreSelect id={`splice-input-${draft.rowId}`} value={draft.inputCoreId} options={options} onChange={(value) => update("inputCoreId", value)} /></div>
      <div className="noc-field"><label htmlFor={`splice-input-end-${draft.rowId}`}>Ujung</label><select id={`splice-input-end-${draft.rowId}`} className="noc-field-select" value={draft.inputCoreEnd} onChange={(event) => update("inputCoreEnd", event.target.value)}>{inputEnds.map((end) => <option key={end} value={end}>Ujung {end}</option>)}</select></div>
      <div className="noc-field"><label htmlFor={`splice-output-${draft.rowId}`}>Core keluar</label><CoreSelect id={`splice-output-${draft.rowId}`} value={draft.outputCoreId} options={options} onChange={(value) => update("outputCoreId", value)} /></div>
      <div className="noc-field"><label htmlFor={`splice-output-end-${draft.rowId}`}>Ujung</label><select id={`splice-output-end-${draft.rowId}`} className="noc-field-select" value={draft.outputCoreEnd} onChange={(event) => update("outputCoreEnd", event.target.value)}>{outputEnds.map((end) => <option key={end} value={end}>Ujung {end}</option>)}</select></div>
      <div className="noc-field"><label htmlFor={`splice-loss-${draft.rowId}`}>Estimasi rugi (dB)</label><Input id={`splice-loss-${draft.rowId}`} type="number" min={0} step="0.01" value={draft.estimatedLossText} onChange={(event) => update("estimatedLossText", event.target.value)} placeholder="opsional" /></div>
      <Button type="button" size="sm" variant="ghost" onClick={onRemove} disabled={index === 0} aria-label={`Hapus baris silangan ${index + 1}`}><Trash2 aria-hidden="true" /></Button>
    </div>
  );
}

function SpliceVerdicts({ preview }: { preview: ClosurePreviewResponse }) {
  return <div className="noc-splice-verdicts"><div className="noc-splice-verdict-summary"><NocStatus label={`${preview.ringkas.lolos} lolos`} tone="positive" /><NocStatus label={`${preview.ringkas.gagal} gagal`} tone={preview.ringkas.gagal > 0 ? "danger" : "neutral"} /></div>{preview.verdicts.map((verdict) => <div key={verdict.urutan} className={`noc-splice-verdict ${verdict.ok ? "is-ok" : "is-error"}`}><strong>Baris {verdict.urutan}</strong><span>{verdict.ok ? (verdict.silangNomor ? `Core ${verdict.silangNomor.dari} → Core ${verdict.silangNomor.ke}` : "Valid") : verdict.error}</span></div>)}</div>;
}

function SpliceHistoryRow({ splice, canManage, releasing, onRelease }: { splice: ClosureSplice; canManage: boolean; releasing: boolean; onRelease: (splice: ClosureSplice) => void }) {
  return (
    <article className={`noc-splice-card ${splice.deactivatedAt ? "is-history" : ""}`}>
      <div className="noc-splice-card-heading"><div><strong>{splice.inputCableCode} · Core {splice.inputCoreNumber}</strong><span>Ujung {splice.inputCoreEnd} · {splice.inputCoreColor ?? "warna belum diisi"}</span></div><span className="noc-splice-arrow">{splice.silang ? "→" : "= "}</span><div><strong>{splice.outputCableCode} · Core {splice.outputCoreNumber}</strong><span>Ujung {splice.outputCoreEnd} · {splice.outputCoreColor ?? "warna belum diisi"}</span></div></div>
      <div className="noc-splice-card-meta"><span>{splice.silang ? "Nomor core berubah" : "Nomor core tetap"}</span><span>{splice.estimatedLossDb === null ? "Estimasi rugi: —" : `Estimasi rugi: ${splice.estimatedLossDb} dB`}</span><span>{formatDate(splice.createdAt)}</span></div>
      <p className="noc-splice-reason">{splice.reason}</p>
      {splice.deactivatedAt && <div className="noc-splice-history-note">Dilepas {formatDate(splice.deactivatedAt)}{splice.deactivatedReason ? ` · ${splice.deactivatedReason}` : ""}</div>}
      {canManage && !splice.deactivatedAt && <Button type="button" size="sm" variant="outline" onClick={() => onRelease(splice)} disabled={releasing}>Lepas silangan</Button>}
    </article>
  );
}

export function ClosureDetailPage({ closureId }: { closureId: string }) {
  const { session } = useSession();
  const canManage = session?.user.role === "admin" || session?.user.role === "noc";
  const encodedId = encodeURIComponent(closureId);
  const [showHistory, setShowHistory] = useState(false);
  const { data: detail, error, isLoading, mutate } = useSWR<ClosureDetailResponse>(
    `/api/v1/ftth/closures/${encodedId}${showHistory ? "?riwayat=1" : ""}`,
    getJson<ClosureDetailResponse>,
    { revalidateOnFocus: false },
  );
  const { data: cablesData } = useSWR<FiberCablesResponse>(canManage ? "/api/v1/ftth/cables" : null, getJson<FiberCablesResponse>, { revalidateOnFocus: false });
  const cableIds = cablesData?.cables.map((cable) => cable.id) ?? [];
  const detailsKey = cableIds.length && canManage ? (["closure-core-details", ...cableIds] as const) : null;
  const { data: cableDetails, error: coreError, isLoading: coreLoading } = useSWR<FiberCableDetail[]>(detailsKey, fetchCableDetails, { revalidateOnFocus: false });
  const coreOptions = useMemo<CoreOption[]>(
    () => (cableDetails ?? []).flatMap((cable) => cable.cores.filter((core) => core.status === "baik" && core.ujungTerpakai.length < 2).map((core) => ({ id: core.id, cableCode: cable.code, coreNumber: core.coreNumber, color: core.color, purpose: core.purpose, availableEnds: (["A", "B"] as const).filter((end) => !core.ujungTerpakai.includes(end)) }))),
    [cableDetails],
  );
  const [drafts, setDrafts] = useState<SpliceDraft[]>([newDraft()]);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<ClosurePreviewResponse | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [releaseTarget, setReleaseTarget] = useState<ClosureSplice | null>(null);
  const [releaseReason, setReleaseReason] = useState("");

  function updateDraft(index: number, next: SpliceDraft) {
    setDrafts((current) => current.map((draft, i) => i === index ? next : draft));
    setPreview(null);
  }

  function addDraft() {
    setDrafts((current) => [...current, newDraft()]);
    setPreview(null);
  }

  function removeDraft(index: number) {
    setDrafts((current) => current.filter((_, i) => i !== index));
    setPreview(null);
  }

  function payloadRows(): ClosureSpliceRow[] {
    return drafts.map((draft) => ({ inputCoreId: draft.inputCoreId, inputCoreEnd: draft.inputCoreEnd, outputCoreId: draft.outputCoreId, outputCoreEnd: draft.outputCoreEnd, estimatedLossDb: draft.estimatedLossText.trim() === "" ? null : Number(draft.estimatedLossText) }));
  }

  async function runPreview() {
    setSaving(true);
    setActionError(null);
    try {
      const result = await sendJson<ClosurePreviewResponse>("POST", `/api/v1/ftth/closures/${encodedId}/splices/preview`, { rows: payloadRows() });
      setPreview(result);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Pratinjau silangan gagal.");
    } finally {
      setSaving(false);
    }
  }

  async function commitSplices() {
    if (!preview || preview.ringkas.gagal > 0 || !reason.trim()) return;
    setSaving(true);
    setActionError(null);
    try {
      await sendJson<ClosureCommitResponse>("POST", `/api/v1/ftth/closures/${encodedId}/splices`, { rows: payloadRows(), reason: reason.trim() });
      setDrafts([newDraft()]);
      setPreview(null);
      setReason("");
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Silangan gagal disimpan.");
      await mutate();
    } finally {
      setSaving(false);
    }
  }

  async function releaseSplice() {
    if (!releaseTarget || !releaseReason.trim()) return;
    setSaving(true);
    setActionError(null);
    try {
      await sendJson("POST", `/api/v1/ftth/splices/${encodeURIComponent(releaseTarget.id)}/release`, { reason: releaseReason.trim() });
      setReleaseTarget(null);
      setReleaseReason("");
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Silangan gagal dilepas.");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <main className="noc-page noc-feature-page"><NocState kind="loading">Memuat matriks closure…</NocState></main>;
  if (error || !detail) return <main className="noc-page noc-feature-page"><Link className="noc-otb-back" href="/ftth/closures"><ArrowLeft aria-hidden="true" /> Kembali ke daftar closure</Link><NocState kind="error">{error instanceof ApiError ? error.message : "Detail closure tidak dapat dimuat."}</NocState></main>;

  return (
    <main className="noc-page noc-feature-page">
      <div className="noc-fiber-heading"><Link className="noc-otb-back" href="/ftth/closures"><ArrowLeft aria-hidden="true" /> Kembali ke daftar closure</Link><div className="noc-otb-heading-main"><div><div className="noc-otb-title-line"><span>Detail Closure</span><NocStatus label={closureStatusLabels[detail.status]} tone={closureTone(detail.status)} /></div><h1>{detail.code}</h1><p>{detail.name ?? "Tanpa nama closure"}{detail.siteName ? ` · ${detail.siteName}` : ""}</p></div><Button type="button" size="sm" variant="ghost" onClick={() => { void mutate(); }} aria-label="Muat ulang closure"><RefreshCw aria-hidden="true" /></Button></div></div>
      <div className="noc-fiber-facts"><div><span>Tipe</span><strong>{closureTypeLabels[detail.type]}</strong></div><div><span>Lokasi</span><strong>{detail.siteName ?? (detail.latitude !== null && detail.longitude !== null ? `${detail.latitude}, ${detail.longitude}` : "—")}</strong></div><div><span>Silangan ditampilkan</span><strong>{detail.splices.length}</strong></div><div><span>Status</span><strong>{closureStatusLabels[detail.status]}</strong></div></div>

      <NocPanel title="Silangan Core (Closure / Joint)" description="Nomor core masuk dan keluar ditampilkan berdampingan; silangan dihitung server." action={<div className="noc-panel-actions"><label className="noc-toggle"><input type="checkbox" checked={showHistory} onChange={(event) => setShowHistory(event.target.checked)} /><span>Tampilkan riwayat</span></label><Button type="button" size="sm" variant="ghost" onClick={() => { void mutate(); }} aria-label="Muat ulang matriks"><RefreshCw aria-hidden="true" /></Button></div>}>
        {detail.splices.length === 0 && <NocState kind="empty">Belum ada silangan {showHistory ? "atau riwayat silangan" : "aktif"} pada closure ini.</NocState>}
        {detail.splices.length > 0 && <div className="noc-splice-list">{detail.splices.map((splice) => <SpliceHistoryRow key={splice.id} splice={splice} canManage={canManage} releasing={saving && releaseTarget?.id === splice.id} onRelease={(target) => { setReleaseTarget(target); setActionError(null); }} />)}</div>}
      </NocPanel>

      <TopologyHistoryPanel entityType="fiber_closure" entityId={detail.id} description="Perubahan closure dan silangan terbaru ditampilkan lebih dulu." />

      <NocPanel title="Pasang silangan" description="Susun batch, jalankan pratinjau, lalu commit. Server menjamin semua atau tidak sama sekali.">
        {!canManage && <NocState kind="empty">Pemasangan silangan memerlukan peran admin atau NOC.</NocState>}
        {canManage && coreLoading && <NocState kind="loading">Memuat pilihan core…</NocState>}
        {canManage && coreError && <NocState kind="error">{coreError instanceof ApiError ? coreError.message : "Pilihan core tidak dapat dimuat."}</NocState>}
        {canManage && !coreLoading && !coreError && coreOptions.length === 0 && <NocState kind="empty">Belum ada core kosong yang bisa disilangkan.</NocState>}
        {canManage && !coreLoading && !coreError && coreOptions.length > 0 && <div className="noc-splice-composer"><div className="noc-splice-drafts">{drafts.map((draft, index) => <SpliceDraftRow key={draft.rowId} draft={draft} index={index} options={coreOptions} onChange={(next) => updateDraft(index, next)} onRemove={() => removeDraft(index)} />)}</div><Button type="button" size="sm" variant="outline" onClick={addDraft}><Plus aria-hidden="true" /> Tambah baris</Button><div className="noc-field"><label htmlFor="splice-reason">Alasan batch</label><Input id="splice-reason" value={reason} onChange={(event) => { setReason(event.target.value); setPreview(null); }} placeholder="Contoh: pemulihan jalur setelah perbaikan closure" /></div><div className="noc-splice-actions"><Button type="button" variant="outline" onClick={() => { void runPreview(); }} disabled={saving}>{saving ? "Memeriksa…" : "Pratinjau"}</Button><Button type="button" onClick={() => { void commitSplices(); }} disabled={saving || !preview || preview.ringkas.gagal > 0 || !reason.trim()}>{saving ? "Menyimpan…" : "Commit silangan"}</Button></div>{preview && <SpliceVerdicts preview={preview} />}{actionError && <NocState kind="error">{actionError}</NocState>}</div>}
      </NocPanel>

      {releaseTarget && <div className="noc-release-bar"><div><strong>Lepas silangan {releaseTarget.inputCableCode} Core {releaseTarget.inputCoreNumber} → {releaseTarget.outputCableCode} Core {releaseTarget.outputCoreNumber}</strong><span>Baris tidak dihapus; server menyimpan riwayat pelepasan.</span></div><Input value={releaseReason} onChange={(event) => setReleaseReason(event.target.value)} placeholder="Alasan pelepasan" aria-label="Alasan pelepasan silangan" /><Button type="button" variant="destructive" onClick={() => { void releaseSplice(); }} disabled={saving || !releaseReason.trim()}>Lepas</Button><Button type="button" variant="ghost" onClick={() => setReleaseTarget(null)}>Batal</Button></div>}
    </main>
  );
}

export default ClosureDirectoryPage;
