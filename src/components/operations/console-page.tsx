"use client";

import { useState } from "react";
import useSWR from "swr";
import { BookOpen, Check, CircleAlert, RefreshCw, ShieldCheck, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, getJson, sendJson } from "@/lib/api/http";
import { NocPageHeader, NocPanel, NocState, NocStatus } from "@/components/noc-ui";
import { useSession } from "@/hooks/use-session";
import type {
  ConsoleCommandResponse,
  OltConsoleTarget,
  OltConsoleTargetsResponse,
} from "@/types/operations";

const readOnlyCommands = ["show version", "display version", "show system", "enable", "?", "exit"];

function errorTitle(error: unknown) {
  if (!(error instanceof ApiError)) return "Konsol tidak dapat dihubungi";
  if (error.status === 403) return "Perintah ditolak daftar putih";
  if (error.status === 409) return "Konfigurasi konsol belum lengkap";
  if (error.status === 429) return "Batas perintah tercapai";
  if (error.status === 502) return "Perangkat tidak menjawab";
  return "Konsol tidak dapat dihubungi";
}

function targetLabel(target: OltConsoleTarget) {
  const detail = [target.vendor, target.model].filter(Boolean).join(" · ");
  return detail ? `${target.name} · ${detail}` : target.name;
}

function targetOptionLabel(target: OltConsoleTarget) {
  const status = target.konsolSiap
    ? "Siap"
    : `Belum siap: ${target.alasan ?? "Konsol belum siap dipakai."}`;
  return `${targetLabel(target)} — ${status}`;
}

function targetSiteLabel(target: OltConsoleTarget) {
  return target.siteName ?? "Situs belum ditentukan";
}

export default function ConsolePage() {
  const { session } = useSession();
  const hasSession = Boolean(session);
  const {
    data: targetsData,
    error: targetsError,
    isLoading: targetsLoading,
    mutate: refreshTargets,
  } = useSWR<OltConsoleTargetsResponse>(
    hasSession ? "/api/v1/ftth/olts" : null,
    getJson<OltConsoleTargetsResponse>,
    { revalidateOnFocus: false },
  );
  const [selectedOltId, setSelectedOltId] = useState("");
  const [command, setCommand] = useState("");
  const [response, setResponse] = useState<ConsoleCommandResponse | null>(null);
  const [requestError, setRequestError] = useState<ApiError | Error | null>(null);
  const [busy, setBusy] = useState(false);
  const targets = targetsData?.olts ?? [];
  const readyTargets = targets.filter((target) => target.konsolSiap);
  const unavailableTargets = targets.filter((target) => !target.konsolSiap);
  const activeTarget =
    targets.find((target) => target.id === selectedOltId && target.konsolSiap) ??
    readyTargets[0] ??
    null;
  const activeOltId = activeTarget?.id ?? "";
  const consoleAvailable = targetsData?.konsolTersedia === true;
  const consoleUnavailable = targetsData?.konsolTersedia === false;

  async function runCommand(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeOltId || !command.trim()) return;
    setBusy(true);
    setRequestError(null);
    setResponse(null);
    try {
      const result = await sendJson<ConsoleCommandResponse>("POST", "/api/v1/devices/console", {
        oltId: activeOltId,
        command: command.trim(),
      });
      setResponse(result);
    } catch (cause) {
      setRequestError(cause instanceof ApiError || cause instanceof Error ? cause : new Error("Konsol tidak dapat dihubungi."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="noc-page noc-feature-page noc-console-page">
      <NocPageHeader
        title="Konsol perangkat"
        description="Baca output OLT dari dalam portal dengan daftar putih perintah dan jejak audit."
        action={<NocStatus label="Baca-saja" tone="info" />}
      />

      {consoleUnavailable && <NocState kind="empty">Konsol hanya tersedia untuk peran admin atau NOC.</NocState>}

      {hasSession && !consoleUnavailable && (
        <div className="noc-console-grid">
          <NocPanel title="Buka konsol" description="Pilih perangkat dari daftar. Host dan port tidak pernah diisi dari browser." action={<Button type="button" size="sm" variant="ghost" onClick={() => refreshTargets()}><RefreshCw aria-label="Muat ulang daftar OLT" /></Button>}>
            <div className="noc-console-guard">
              <ShieldCheck aria-hidden="true" />
              <div><strong>Konsol ini BACA-SAJA dan tercatat.</strong><span>Perintah yang mengubah keadaan perangkat akan ditolak sebelum koneksi dibuka.</span></div>
            </div>

            {targetsLoading && <NocState kind="loading">Memuat daftar OLT…</NocState>}
            {targetsError && (
              <NocState kind="error">{targetsError instanceof ApiError ? targetsError.message : "Daftar OLT tidak dapat dimuat."}</NocState>
            )}
            {!targetsLoading && !targetsError && targets.length === 0 && <NocState kind="empty">Belum ada OLT yang dapat dipilih.</NocState>}

            {consoleAvailable && !targetsLoading && !targetsError && unavailableTargets.length > 0 && (
              <div className="noc-console-unavailable" role="status">
                <div className="noc-console-unavailable-heading"><CircleAlert aria-hidden="true" /><strong>OLT belum siap dibuka</strong></div>
                <ul>
                  {unavailableTargets.map((target) => <li key={target.id}><strong>{target.name}</strong> — {target.alasan ?? "Konsol belum siap dipakai."}</li>)}
                </ul>
              </div>
            )}

            {consoleAvailable && !targetsLoading && !targetsError && readyTargets.length > 0 && (
              <form className="noc-feature-form" onSubmit={runCommand}>
                <div className="noc-field">
                  <label htmlFor="console-olt">Perangkat OLT</label>
                  <select id="console-olt" className="noc-field-select" value={activeOltId} onChange={(event) => setSelectedOltId(event.target.value)} disabled={busy}>
                    <option value="">Pilih OLT</option>
                    {targets.map((target) => <option key={target.id} value={target.id} disabled={!target.konsolSiap}>{targetOptionLabel(target)}</option>)}
                  </select>
                  {activeTarget && (
                    <div className="noc-console-target-detail" aria-live="polite">
                      <div className="noc-console-target-detail-heading">
                        <div><strong>{activeTarget.name}</strong><span>{[activeTarget.vendor, activeTarget.model].filter(Boolean).join(" · ") || "Vendor/model belum diisi"}</span></div>
                        <NocStatus label="Siap digunakan" tone="positive" />
                      </div>
                      <div className="noc-console-target-facts">
                        <span>Situs: {targetSiteLabel(activeTarget)}</span>
                        <span>IP manajemen: {activeTarget.managementIp}</span>
                        <span>{activeTarget.odpCount} ODP tertaut</span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="noc-field">
                  <label htmlFor="console-command">Perintah baca</label>
                  <Input id="console-command" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="show version" autoComplete="off" spellCheck={false} disabled={!activeOltId || busy} />
                  <span className="noc-field-help">Contoh yang lazim: show, display, enable, interface, exit, quit, end, ?</span>
                </div>
                <div className="noc-console-presets" aria-label="Contoh perintah baca">
                  {readOnlyCommands.map((preset) => <button key={preset} type="button" onClick={() => setCommand(preset)} disabled={!activeOltId || busy}>{preset}</button>)}
                </div>
                {requestError && (
                  <div className={`noc-console-error is-${requestError instanceof ApiError ? requestError.status : "unknown"}`} role="alert">
                    <strong>{errorTitle(requestError)}</strong>
                    <span>{requestError.message}</span>
                  </div>
                )}
                <Button type="submit" disabled={!activeOltId || !command.trim() || busy}><Terminal aria-hidden="true" /> {busy ? "Membaca…" : "Jalankan perintah baca"}</Button>
              </form>
            )}

            {consoleAvailable && !targetsLoading && !targetsError && targets.length > 0 && readyTargets.length === 0 && <NocState kind="empty">Belum ada OLT yang siap dibuka. Periksa alasan pada daftar perangkat di atas.</NocState>}
          </NocPanel>

          <NocPanel title="Output perangkat" description={response ? `${response.olt.name} · ${response.command}` : "Output mentah dipertahankan agar jawaban perangkat dapat ditelusuri apa adanya."} action={<Button type="button" size="sm" variant="ghost" onClick={() => { setResponse(null); setRequestError(null); }} disabled={!response && !requestError}><RefreshCw aria-label="Bersihkan output konsol" /></Button>}>
            {response ? (
              <div className="noc-console-result">
                <div className="noc-console-result-meta"><span><Check aria-hidden="true" /> Perintah selesai</span><small>{response.command}</small></div>
                <pre>{response.output || "(Perangkat mengembalikan output kosong.)"}</pre>
              </div>
            ) : (
              <div className="noc-console-empty"><Terminal aria-hidden="true" /><strong>Belum ada output</strong><span>Pilih OLT dan jalankan satu perintah baca untuk melihat jawaban perangkat.</span></div>
            )}
          </NocPanel>
        </div>
      )}

      <div className="noc-console-audit"><BookOpen aria-hidden="true" /><span><strong>Setiap percobaan tercatat</strong> · Perintah yang ditolak, berhasil, atau gagal disimpan bersama pengguna dan perangkatnya. Tidak ada tombol untuk mengubah keadaan perangkat dari layar ini.</span></div>
    </main>
  );
}
