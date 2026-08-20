"use client";

import { useState } from "react";
import useSWR from "swr";
import { ChevronDown, Plus, Server, Waypoints } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, getJson, sendJson } from "@/lib/api/http";
import { formatNumber } from "@/lib/noc-format";
import { NocPageHeader, NocPanel, NocState, NocStatus } from "@/components/noc-ui";
import { useSession } from "@/hooks/use-session";
import type {
  AddressesResponse,
  IpAddressStatus,
  NetworkSite,
  SitesResponse,
  SubnetsResponse,
} from "@/types/operations";

const statusLabels: Record<IpAddressStatus, string> = {
  dipakai: "Dipakai",
  dicadangkan: "Dicadangkan",
  bebas: "Bebas",
};

function AddressList({ subnetId }: { subnetId: string }) {
  const { data, error, isLoading, mutate } = useSWR<AddressesResponse>(
    `/api/v1/subnets/${subnetId}/addresses`,
    getJson<AddressesResponse>,
    { revalidateOnFocus: false },
  );
  const { session } = useSession();
  const canManage = session?.user.role === "admin" || session?.user.role === "noc";
  const [form, setForm] = useState({ address: "", label: "", assetId: "", status: "dipakai" as IpAddressStatus });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function addAddress(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await sendJson("POST", `/api/v1/subnets/${subnetId}/addresses`, {
        address: form.address,
        label: form.label || undefined,
        assetId: form.assetId || undefined,
        status: form.status,
      });
      setForm({ address: "", label: "", assetId: "", status: "dipakai" });
      await mutate();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Alamat gagal disimpan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="noc-address-detail">
      {canManage && (
        <form className="noc-inline-form" onSubmit={addAddress}>
          <Input required value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} placeholder="192.168.1.10" aria-label="Alamat IP" />
          <Input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="Label" aria-label="Label alamat" />
          <Input value={form.assetId} onChange={(event) => setForm({ ...form, assetId: event.target.value })} placeholder="Asset ID (opsional)" aria-label="Asset ID" />
          <select className="noc-field-select" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as IpAddressStatus })} aria-label="Status alamat">
            {Object.keys(statusLabels).map((status) => <option key={status} value={status}>{statusLabels[status as IpAddressStatus]}</option>)}
          </select>
          <Button type="submit" size="sm" disabled={saving}><Plus aria-hidden="true" /> Tambah</Button>
        </form>
      )}
      {formError && <NocState kind="error">{formError}</NocState>}
      {isLoading && <NocState kind="loading">Memuat alamat…</NocState>}
      {error && <NocState kind="error">{error instanceof ApiError ? error.message : "Alamat tidak dapat dimuat."}</NocState>}
      {!isLoading && !error && data?.addresses.length === 0 && <NocState kind="empty">Belum ada alamat di subnet ini.</NocState>}
      {data && data.addresses.length > 0 && (
        <div className="noc-mini-table-wrap">
          <table className="noc-mini-table">
            <thead><tr><th>Alamat</th><th>Label</th><th>Asset</th><th>Status</th></tr></thead>
            <tbody>
              {data.addresses.map((address) => (
                <tr key={address.id}>
                  <td className="is-mono">{address.address}</td>
                  <td>{address.label || "—"}</td>
                  <td className="is-mono">{address.assetId || "—"}</td>
                  <td><NocStatus label={statusLabels[address.status]} tone={address.status === "dipakai" ? "positive" : address.status === "dicadangkan" ? "warning" : "neutral"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface SubnetForm {
  cidr: string;
  name: string;
  gateway: string;
  vlanId: string;
  siteId: string;
  purpose: string;
}

const emptySubnet: SubnetForm = { cidr: "", name: "", gateway: "", vlanId: "", siteId: "", purpose: "" };

export default function IpamPage() {
  const { session } = useSession();
  const canManage = session?.user.role === "admin" || session?.user.role === "noc";
  const { data, error, isLoading, mutate } = useSWR<SubnetsResponse>("/api/v1/subnets", getJson<SubnetsResponse>, { revalidateOnFocus: false });
  const { data: sitesData } = useSWR<SitesResponse>("/api/v1/sites", getJson<SitesResponse>, { revalidateOnFocus: false });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<SubnetForm>(emptySubnet);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const subnets = data?.subnets ?? [];
  const sites = sitesData?.sites ?? [];
  const siteNames = new Map<string, string>(sites.map((site: NetworkSite) => [site.id, site.name]));

  async function createSubnet(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await sendJson("POST", "/api/v1/subnets", {
        cidr: form.cidr,
        name: form.name,
        gateway: form.gateway || undefined,
        vlanId: form.vlanId.trim() === "" ? undefined : Number(form.vlanId),
        siteId: form.siteId || undefined,
        purpose: form.purpose || undefined,
      });
      setForm(emptySubnet);
      await mutate();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Subnet gagal disimpan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="noc-page noc-feature-page">
      <NocPageHeader title="IP address management" description="Kelola subnet dan alamat secara terukur tanpa menghitung ulang angka pemakaian di browser." action={<NocStatus label={`${subnets.length} subnet`} tone="info" />} />
      <NocPanel title="Subnet" description="`usedCount` berasal dari server dan mencerminkan alamat yang tercatat saat ini." action={<Waypoints aria-hidden="true" className="noc-panel-heading-icon" />}>
        {canManage && (
          <form className="noc-feature-form noc-form-band" onSubmit={createSubnet}>
            <div className="noc-form-grid is-three">
              <div className="noc-field"><Label htmlFor="subnet-cidr">CIDR</Label><Input id="subnet-cidr" required value={form.cidr} onChange={(event) => setForm({ ...form, cidr: event.target.value })} placeholder="10.10.0.0/24" /></div>
              <div className="noc-field"><Label htmlFor="subnet-name">Nama subnet</Label><Input id="subnet-name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Distribusi pusat" /></div>
              <div className="noc-field"><Label htmlFor="subnet-purpose">Tujuan <span>(opsional)</span></Label><Input id="subnet-purpose" value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value })} placeholder="Management" /></div>
              <div className="noc-field"><Label htmlFor="subnet-gateway">Gateway <span>(opsional)</span></Label><Input id="subnet-gateway" value={form.gateway} onChange={(event) => setForm({ ...form, gateway: event.target.value })} placeholder="10.10.0.1" /></div>
              <div className="noc-field"><Label htmlFor="subnet-vlan">VLAN ID <span>(opsional)</span></Label><Input id="subnet-vlan" inputMode="numeric" value={form.vlanId} onChange={(event) => setForm({ ...form, vlanId: event.target.value })} placeholder="100" /></div>
              <div className="noc-field"><Label htmlFor="subnet-site">Situs <span>(opsional)</span></Label><select id="subnet-site" className="noc-field-select" value={form.siteId} onChange={(event) => setForm({ ...form, siteId: event.target.value })}><option value="">Tanpa situs</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.code} · {site.name}</option>)}</select></div>
            </div>
            {formError && <NocState kind="error">{formError}</NocState>}
            <Button type="submit" disabled={saving}><Plus aria-hidden="true" /> {saving ? "Menyimpan…" : "Tambah subnet"}</Button>
          </form>
        )}
        {!canManage && <p className="noc-permission-note">Penambahan subnet memerlukan peran admin atau NOC.</p>}
        {isLoading && <NocState kind="loading">Memuat subnet…</NocState>}
        {error && <NocState kind="error">{error instanceof ApiError ? error.message : "Subnet tidak dapat dimuat."}</NocState>}
        {!isLoading && !error && subnets.length === 0 && <NocState kind="empty">Belum ada subnet terdaftar.</NocState>}
        {subnets.length > 0 && (
          <div className="noc-subnet-list">
            {subnets.map((subnet) => {
              const open = selectedId === subnet.id;
              return (
                <div key={subnet.id} className={`noc-subnet-item ${open ? "is-open" : ""}`}>
                  <button type="button" className="noc-subnet-summary" onClick={() => setSelectedId(open ? null : subnet.id)} aria-expanded={open}>
                    <span className="noc-data-row-leading is-subnet"><Server aria-hidden="true" /></span>
                    <span className="noc-subnet-copy"><strong>{subnet.cidr}</strong><span>{subnet.name}{subnet.siteId && siteNames.get(subnet.siteId) ? ` · ${siteNames.get(subnet.siteId)}` : ""}</span></span>
                    <span className="noc-subnet-count"><strong>{formatNumber(subnet.usedCount)}</strong><small>alamat tercatat</small></span>
                    <ChevronDown aria-hidden="true" className="noc-subnet-chevron" />
                  </button>
                  {open && <AddressList subnetId={subnet.id} />}
                </div>
              );
            })}
          </div>
        )}
      </NocPanel>
    </main>
  );
}
