"use client";

import { useState } from "react";
import useSWR from "swr";
import { Check, Clipboard, KeyRound, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NocPanel, NocState, NocStatus } from "@/components/noc-ui";
import { useSession } from "@/hooks/use-session";
import { ApiError, getJson, sendJson } from "@/lib/api/http";
import { formatDateTime } from "@/lib/noc-format";
import type { TvTokenIssued, TvTokenSummary, TvTokensResponse } from "@/types/tv";

function tokenState(token: TvTokenSummary) {
  if (token.revokedAt) return { label: "Dicabut", tone: "danger" as const };
  if (new Date(token.expiresAt).getTime() <= Date.now()) return { label: "Kedaluwarsa", tone: "warning" as const };
  return { label: "Aktif", tone: "positive" as const };
}

export default function TvTokenManager() {
  const { session } = useSession();
  const isAdmin = session?.user.role === "admin";
  const { data, error, isLoading, mutate } = useSWR<TvTokensResponse>(
    isAdmin ? "/api/v1/tv/tokens" : null,
    getJson<TvTokensResponse>,
    { revalidateOnFocus: false },
  );
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("90");
  const [saving, setSaving] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [issued, setIssued] = useState<TvTokenIssued | null>(null);
  const [copied, setCopied] = useState<"token" | "url" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!isAdmin) return null;

  async function issueToken(event: React.FormEvent) {
    event.preventDefault();
    const days = Number(expiresInDays);
    if (!name.trim()) {
      setActionError("Nama layar wajib diisi.");
      return;
    }
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      setActionError("Masa berlaku harus bilangan bulat antara 1 dan 365 hari.");
      return;
    }
    setSaving(true);
    setActionError(null);
    setCopied(null);
    try {
      const result = await sendJson<TvTokenIssued>("POST", "/api/v1/tv/tokens", {
        name: name.trim(),
        expiresInDays: days,
      });
      setIssued(result);
      setName("");
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Token TV gagal diterbitkan.");
    } finally {
      setSaving(false);
    }
  }

  async function copyValue(kind: "token" | "url", value: string) {
    setActionError(null);
    try {
      if (!navigator.clipboard) throw new Error("Fitur salin tidak tersedia di browser ini.");
      await navigator.clipboard.writeText(value);
      setCopied(kind);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Teks gagal disalin.");
    }
  }

  async function revokeToken(token: TvTokenSummary) {
    if (!window.confirm(`Cabut token TV “${token.name}”? Layar akan berhenti pada polling berikutnya.`)) return;
    setRevokingId(token.id);
    setActionError(null);
    try {
      await sendJson("POST", `/api/v1/tv/tokens/${encodeURIComponent(token.id)}/revoke`);
      if (issued?.id === token.id) setIssued(null);
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Token TV gagal dicabut.");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <NocPanel
      className="noc-tv-token-panel"
      title="Token wallboard TV"
      description="Terbitkan URL khusus untuk layar NOC. Token hanya dikembalikan sekali oleh server."
      action={<Button type="button" size="sm" variant="ghost" onClick={() => { void mutate(); }} aria-label="Muat ulang token TV"><RefreshCw aria-hidden="true" /></Button>}
    >
      <div className="noc-tv-token-content">
        <form className="noc-tv-token-form" onSubmit={issueToken}>
          <div className="noc-field"><label htmlFor="tv-token-name">Nama layar</label><Input id="tv-token-name" required maxLength={80} placeholder="TV ruang NOC" value={name} onChange={(event) => setName(event.target.value)} /></div>
          <div className="noc-field"><label htmlFor="tv-token-expiry">Berlaku (hari)</label><Input id="tv-token-expiry" type="number" min={1} max={365} value={expiresInDays} onChange={(event) => setExpiresInDays(event.target.value)} /></div>
          <Button type="submit" disabled={saving}>{saving ? "Menerbitkan…" : <><KeyRound aria-hidden="true" /> Terbitkan token</>}</Button>
        </form>

        {actionError && <div className="noc-tv-token-error" role="alert"><ShieldAlert aria-hidden="true" /><span>{actionError}</span></div>}

        {issued && (
          <div className="noc-tv-token-issued" role="status">
            <div className="noc-tv-token-issued-heading"><div><strong>Token baru untuk {issued.name}</strong><span>{issued.peringatan}</span></div><Button type="button" size="sm" variant="ghost" onClick={() => { setIssued(null); setCopied(null); }}>Tutup</Button></div>
            <div className="noc-tv-token-secret"><label htmlFor="tv-issued-token">Token</label><div><code id="tv-issued-token">{issued.token}</code><Button type="button" size="sm" variant="outline" onClick={() => { void copyValue("token", issued.token); }}><Clipboard aria-hidden="true" /> {copied === "token" ? "Tersalin" : "Salin"}</Button></div></div>
            <div className="noc-tv-token-secret"><label htmlFor="tv-issued-url">URL layar</label><div><code id="tv-issued-url">{issued.url}</code><Button type="button" size="sm" variant="outline" onClick={() => { void copyValue("url", issued.url); }}><Clipboard aria-hidden="true" /> {copied === "url" ? "Tersalin" : "Salin URL"}</Button></div></div>
            <p><ShieldAlert aria-hidden="true" /> Simpan sekarang. Menutup panel ini berarti token tidak bisa dibaca lagi dan layar memerlukan token baru.</p>
          </div>
        )}

        {isLoading && <NocState kind="loading">Memuat daftar token TV…</NocState>}
        {error && <NocState kind="error">{error instanceof ApiError ? error.message : "Daftar token TV tidak dapat dimuat."}</NocState>}
        {!isLoading && !error && data?.tokens.length === 0 && <NocState kind="empty">Belum ada token wallboard.</NocState>}
        {!isLoading && !error && data && data.tokens.length > 0 && (
          <div className="noc-tv-token-list">
            {data.tokens.map((token) => {
              const state = tokenState(token);
              return (
                <div className="noc-tv-token-row" key={token.id}>
                  <div className="noc-tv-token-row-main"><div><strong>{token.name}</strong><span className="is-mono">{token.tokenPrefix}••••••••</span></div><NocStatus label={state.label} tone={state.tone} /></div>
                  <dl className="noc-tv-token-facts"><div><dt>Dibuat</dt><dd>{formatDateTime(token.createdAt)}</dd></div><div><dt>Berlaku sampai</dt><dd>{formatDateTime(token.expiresAt)}</dd></div><div><dt>Terakhir dipakai</dt><dd>{formatDateTime(token.lastUsedAt, "Belum pernah")}</dd></div><div><dt>Pemakaian</dt><dd>{token.useCount}×</dd></div></dl>
                  {!token.revokedAt && state.label === "Aktif" && <Button type="button" size="sm" variant="destructive" onClick={() => { void revokeToken(token); }} disabled={revokingId === token.id}><Trash2 aria-hidden="true" /> {revokingId === token.id ? "Mencabut…" : "Cabut"}</Button>}
                  {token.revokedAt && <small className="noc-tv-token-revoked"><Check aria-hidden="true" /> Dicabut {formatDateTime(token.revokedAt)}</small>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </NocPanel>
  );
}
