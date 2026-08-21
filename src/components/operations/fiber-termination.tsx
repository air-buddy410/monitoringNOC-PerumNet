"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NocState, NocStatus } from "@/components/noc-ui";
import { ApiError, getJson, sendJson } from "@/lib/api/http";
import type { FiberCableDetail, FiberCableSummary } from "@/types/operations";

interface CoreOption {
  id: string;
  cableCode: string;
  cableName: string | null;
  coreNumber: number;
  color: string | null;
  purpose: "feeder" | "distribution";
  availableEnds: Array<"A" | "B">;
}

type CableDetailsKey = readonly [string, ...string[]];

async function fetchCableDetails([, ...ids]: CableDetailsKey) {
  return Promise.all(ids.map((id) => getJson<FiberCableDetail>(`/api/v1/ftth/cables/${encodeURIComponent(id)}`)));
}

export function OtbTerminationPanel({
  otbPortId,
  portLabel,
  onCompleted,
  onCancel,
}: {
  otbPortId: string;
  portLabel: string;
  onCompleted: () => Promise<void>;
  onCancel: () => void;
}) {
  const { data: cableData, error: cableError, isLoading: cablesLoading } = useSWR<{ cables: FiberCableSummary[] }>(
    "/api/v1/ftth/cables",
    getJson<{ cables: FiberCableSummary[] }>,
    { revalidateOnFocus: false },
  );
  const cableIds = cableData?.cables.map((cable) => cable.id) ?? [];
  const detailsKey = cableIds.length ? (["fiber-cable-details", ...cableIds] as const) : null;
  const { data: details, error: detailsError, isLoading: detailsLoading } = useSWR<FiberCableDetail[]>(
    detailsKey,
    fetchCableDetails,
    { revalidateOnFocus: false },
  );
  const [selectedCoreId, setSelectedCoreId] = useState("");
  const [coreEnd, setCoreEnd] = useState<"A" | "B">("A");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coreOptions = useMemo<CoreOption[]>(
    () => (details ?? []).flatMap((cable) => cable.cores
      .filter((core) => core.status === "baik" && core.ujungTerpakai.length < 2)
      .map((core) => ({
        id: core.id,
        cableCode: cable.code,
        cableName: cable.name,
        coreNumber: core.coreNumber,
        color: core.color,
        purpose: core.purpose,
        availableEnds: (["A", "B"] as const).filter((end) => !core.ujungTerpakai.includes(end)),
      }))),
    [details],
  );
  const selectedCore = coreOptions.find((core) => core.id === selectedCoreId);
  const availableEnds = selectedCore?.availableEnds ?? ["A", "B"];
  const loading = cablesLoading || detailsLoading;
  const fetchError = cableError ?? detailsError;

  function selectCore(nextId: string) {
    const nextCore = coreOptions.find((core) => core.id === nextId);
    setSelectedCoreId(nextId);
    setCoreEnd(nextCore?.availableEnds[0] ?? "A");
  }

  async function submit() {
    if (!selectedCoreId || !reason.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await sendJson("POST", "/api/v1/ftth/terminations", {
        coreId: selectedCoreId,
        coreEnd,
        otbPortId,
        reason: reason.trim(),
      });
      await onCompleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Terminasi core gagal disimpan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="noc-otb-termination">
      <div className="noc-otb-termination-heading">
        <div><strong>Terminasi core ke {portLabel}</strong><span>Hanya ID layanan yang boleh tersimpan; identitas pelanggan tidak ditampilkan.</span></div>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Tutup</Button>
      </div>
      {loading && <NocState kind="loading">Memuat core yang tersedia…</NocState>}
      {fetchError && <NocState kind="error">{fetchError instanceof ApiError ? fetchError.message : "Daftar core tidak dapat dimuat."}</NocState>}
      {!loading && !fetchError && coreOptions.length === 0 && <NocState kind="empty">Belum ada core yang dapat diterminasi. Core harus berstatus baik dan masih memiliki ujung kosong.</NocState>}
      {!loading && !fetchError && coreOptions.length > 0 && (
        <div className="noc-feature-form">
          <div className="noc-form-grid is-three">
            <div className="noc-field">
              <label htmlFor="termination-core">Core</label>
              <select id="termination-core" className="noc-field-select" value={selectedCoreId} onChange={(event) => selectCore(event.target.value)}>
                <option value="">Pilih kabel dan core</option>
                {coreOptions.map((core) => <option key={core.id} value={core.id}>{core.cableCode} · Core {core.coreNumber} · {core.color ?? "warna belum diisi"} · {core.purpose}</option>)}
              </select>
            </div>
            <div className="noc-field">
              <label htmlFor="termination-end">Ujung core</label>
              <select id="termination-end" className="noc-field-select" value={coreEnd} onChange={(event) => setCoreEnd(event.target.value as "A" | "B")} disabled={!selectedCoreId}>
                {availableEnds.map((end) => <option key={end} value={end}>Ujung {end}</option>)}
              </select>
            </div>
            <div className="noc-field">
              <label htmlFor="termination-reason">Alasan perubahan</label>
              <Input id="termination-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Contoh: terminasi feeder baru" />
            </div>
          </div>
          {selectedCore && <div className="noc-otb-termination-summary"><NocStatus label={selectedCore.purpose} tone="info" /><span>{selectedCore.cableCode} · Core {selectedCore.coreNumber} · {selectedCore.color ?? "warna belum diisi"}</span></div>}
          {error && <NocState kind="error">{error}</NocState>}
          <div className="noc-otb-termination-actions">
            <Button type="button" onClick={submit} disabled={saving || !selectedCoreId || !reason.trim()}>{saving ? "Menyimpan…" : "Simpan terminasi"}</Button>
            <small>Server akan menolak port atau ujung core yang sudah terpakai.</small>
          </div>
        </div>
      )}
    </div>
  );
}
