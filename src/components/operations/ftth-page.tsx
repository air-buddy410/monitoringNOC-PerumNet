"use client";

import { useState } from "react";
import useSWR from "swr";
import { Cable, Check, MapPin, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, getJson, sendJson } from "@/lib/api/http";
import { NocPageHeader, NocPanel, NocState, NocStatus } from "@/components/noc-ui";
import { useSession } from "@/hooks/use-session";
import type {
  NetworkSite,
  Odp,
  OdpPort,
  OdpPortStatus,
  OdpPortsResponse,
  OdpsResponse,
  SitesResponse,
} from "@/types/operations";

const portStatusLabels: Record<OdpPortStatus, string> = {
  kosong: "Kosong",
  terpakai: "Terpakai",
  rusak: "Rusak",
  dicadangkan: "Dicadangkan",
};

function portTone(status: OdpPortStatus) {
  if (status === "terpakai") return "positive" as const;
  if (status === "rusak") return "danger" as const;
  if (status === "dicadangkan") return "warning" as const;
  return "neutral" as const;
}

function PortRow({ port, onSaved }: { port: OdpPort; onSaved: () => void }) {
  const { session } = useSession();
  const canManage = ["admin", "noc", "engineer"].includes(session?.user.role ?? "");
  const [status, setStatus] = useState<OdpPortStatus>(port.status);
  const [externalServiceId, setExternalServiceId] = useState(port.externalServiceId ?? "");
  const [notes, setNotes] = useState(port.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await sendJson("PATCH", `/api/v1/ftth/odps/${port.odpId}/ports`, {
        portNumber: port.portNumber,
        status,
        externalServiceId: externalServiceId.trim() || null,
        notes: notes.trim() || null,
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Port gagal disimpan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td className="is-mono">P{String(port.portNumber).padStart(2, "0")}</td>
      <td><select className="noc-field-select is-compact" value={status} onChange={(event) => setStatus(event.target.value as OdpPortStatus)} disabled={!canManage}><option value="kosong">Kosong</option><option value="terpakai">Terpakai</option><option value="rusak">Rusak</option><option value="dicadangkan">Dicadangkan</option></select></td>
      <td><Input value={externalServiceId} onChange={(event) => setExternalServiceId(event.target.value)} placeholder="CRM/ALUS service ID" aria-label={`External service ID port ${port.portNumber}`} disabled={!canManage} /></td>
      <td><Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Catatan" aria-label={`Catatan port ${port.portNumber}`} disabled={!canManage} /></td>
      <td>
        <div className="noc-table-action">
          <NocStatus label={portStatusLabels[status]} tone={portTone(status)} />
          {canManage && <Button type="button" size="sm" variant="outline" onClick={save} disabled={saving}>{saving ? "…" : <Check aria-label="Simpan port" />}</Button>}
        </div>
        {error && <small className="noc-inline-error">{error}</small>}
      </td>
    </tr>
  );
}

function OdpPortsPanel({ odpId, onChanged }: { odpId: string; onChanged: () => void }) {
  const { data, error, isLoading, mutate } = useSWR<OdpPortsResponse>(
    `/api/v1/ftth/odps/${odpId}/ports`,
    getJson<OdpPortsResponse>,
    { revalidateOnFocus: false },
  );
  return (
    <div className="noc-odp-ports">
      <div className="noc-detail-heading"><div><strong>Port ODP</strong><span>Identitas pelanggan tidak disimpan di portal ini.</span></div><Button type="button" size="sm" variant="ghost" onClick={() => mutate()}><RefreshCw aria-label="Muat ulang port" /></Button></div>
      {isLoading && <NocState kind="loading">Memuat port…</NocState>}
      {error && <NocState kind="error">{error instanceof ApiError ? error.message : "Port tidak dapat dimuat."}</NocState>}
      {data && data.ports.length === 0 && <NocState kind="empty">ODP ini belum memiliki port.</NocState>}
      {data && data.ports.length > 0 && (
        <div className="noc-mini-table-wrap">
          <table className="noc-mini-table noc-port-table">
            <thead><tr><th>Port</th><th>Status</th><th>External service ID</th><th>Catatan</th><th>Aksi</th></tr></thead>
            <tbody>{data.ports.map((port) => <PortRow key={port.id} port={port} onSaved={async () => { await mutate(); onChanged(); }} />)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface OdpForm {
  code: string;
  name: string;
  siteId: string;
  oltId: string;
  capacity: string;
  latitude: string;
  longitude: string;
}

const emptyOdp: OdpForm = { code: "", name: "", siteId: "", oltId: "", capacity: "8", latitude: "", longitude: "" };

export default function FtthPage() {
  const { session } = useSession();
  const canManage = session?.user.role === "admin" || session?.user.role === "noc";
  const { data, error, isLoading, mutate } = useSWR<OdpsResponse>("/api/v1/ftth/odps", getJson<OdpsResponse>, { revalidateOnFocus: false });
  const { data: sitesData } = useSWR<SitesResponse>("/api/v1/sites", getJson<SitesResponse>, { revalidateOnFocus: false });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<OdpForm>(emptyOdp);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const odps = data?.odps ?? [];
  const sites = sitesData?.sites ?? [];
  const siteNames = new Map<string, string>(sites.map((site: NetworkSite) => [site.id, `${site.code} · ${site.name}`]));

  async function createOdp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await sendJson("POST", "/api/v1/ftth/odps", {
        code: form.code,
        name: form.name,
        siteId: form.siteId || undefined,
        oltId: form.oltId || undefined,
        capacity: Number(form.capacity),
        latitude: form.latitude.trim() === "" ? undefined : Number(form.latitude),
        longitude: form.longitude.trim() === "" ? undefined : Number(form.longitude),
      });
      setForm(emptyOdp);
      await mutate();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "ODP gagal disimpan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="noc-page noc-feature-page">
      <NocPageHeader title="FTTH / ODP" description="Pantau kapasitas ODP dan kelola status port tanpa menyimpan identitas pelanggan." action={<NocStatus label={`${odps.length} ODP`} tone="info" />} />
      <div className="noc-feature-grid is-two-column">
        <NocPanel title="Tambah ODP" description="Pembuatan ODP otomatis menyiapkan seluruh port sesuai kapasitas.">
          {canManage ? (
            <form className="noc-feature-form" onSubmit={createOdp}>
              <div className="noc-form-grid is-two">
                <div className="noc-field"><Label htmlFor="odp-code">Kode ODP</Label><Input id="odp-code" required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="ODP-JKT-001" /></div>
                <div className="noc-field"><Label htmlFor="odp-name">Nama ODP</Label><Input id="odp-name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="ODP Melati 01" /></div>
                <div className="noc-field"><Label htmlFor="odp-capacity">Kapasitas port</Label><Input id="odp-capacity" required type="number" min={1} max={256} value={form.capacity} onChange={(event) => setForm({ ...form, capacity: event.target.value })} /></div>
                <div className="noc-field"><Label htmlFor="odp-site">Situs <span>(opsional)</span></Label><select id="odp-site" className="noc-field-select" value={form.siteId} onChange={(event) => setForm({ ...form, siteId: event.target.value })}><option value="">Tanpa situs</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.code} · {site.name}</option>)}</select></div>
                <div className="noc-field"><Label htmlFor="odp-olt">OLT ID <span>(opsional)</span></Label><Input id="odp-olt" value={form.oltId} onChange={(event) => setForm({ ...form, oltId: event.target.value })} placeholder="asset ID OLT" /></div>
                <div className="noc-field"><Label htmlFor="odp-lat">Latitude <span>(opsional)</span></Label><Input id="odp-lat" inputMode="decimal" value={form.latitude} onChange={(event) => setForm({ ...form, latitude: event.target.value })} placeholder="-6.2" /></div>
                <div className="noc-field"><Label htmlFor="odp-lng">Longitude <span>(opsional)</span></Label><Input id="odp-lng" inputMode="decimal" value={form.longitude} onChange={(event) => setForm({ ...form, longitude: event.target.value })} placeholder="106.8" /></div>
              </div>
              {formError && <NocState kind="error">{formError}</NocState>}
              <Button type="submit" disabled={saving}><Plus aria-hidden="true" /> {saving ? "Menyimpan…" : "Simpan ODP"}</Button>
            </form>
          ) : <NocState kind="empty">Penambahan ODP memerlukan peran admin atau NOC.</NocState>}
        </NocPanel>

        <NocPanel title="Daftar ODP" description="Angka terpakai dan rusak datang langsung dari server.">
          {isLoading && <NocState kind="loading">Memuat ODP…</NocState>}
          {error && <NocState kind="error">{error instanceof ApiError ? error.message : "ODP tidak dapat dimuat."}</NocState>}
          {!isLoading && !error && odps.length === 0 && <NocState kind="empty">Belum ada ODP terdaftar.</NocState>}
          <div className="noc-odp-list">
            {odps.map((odp: Odp) => {
              const open = selectedId === odp.id;
              return (
                <div key={odp.id} className={`noc-odp-item ${open ? "is-open" : ""}`}>
                  <button type="button" className="noc-odp-summary" onClick={() => setSelectedId(open ? null : odp.id)} aria-expanded={open}>
                    <span className="noc-data-row-leading is-ftth"><Cable aria-hidden="true" /></span>
                    <span className="noc-odp-copy"><strong>{odp.code}</strong><span>{odp.name}{odp.siteId && siteNames.get(odp.siteId) ? ` · ${siteNames.get(odp.siteId)}` : ""}</span><small>{odp.latitude !== null && odp.longitude !== null ? <><MapPin aria-hidden="true" /> {odp.latitude}, {odp.longitude}</> : "Koordinat belum tersedia"}</small></span>
                    <span className="noc-odp-count"><strong>{odp.usedPorts}/{odp.capacity}</strong><small>terpakai</small></span>
                    <span className="noc-odp-count is-broken"><strong>{odp.brokenPorts}</strong><small>rusak</small></span>
                    <span className="noc-odp-chevron">{open ? "Tutup" : "Port"}</span>
                  </button>
                  {open && <OdpPortsPanel odpId={odp.id} onChanged={() => mutate()} />}
                </div>
              );
            })}
          </div>
        </NocPanel>
      </div>
    </main>
  );
}
