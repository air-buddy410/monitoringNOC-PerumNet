"use client";

import { useState } from "react";
import useSWR from "swr";
import { MapPinned, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, getJson, sendJson } from "@/lib/api/http";
import { NocPageHeader, NocPanel, NocState, NocStatus } from "@/components/noc-ui";
import { useSession } from "@/hooks/use-session";
import type { NetworkSite, SitesResponse } from "@/types/operations";

interface SiteForm {
  code: string;
  name: string;
  address: string;
  latitude: string;
  longitude: string;
  notes: string;
}

const emptyForm: SiteForm = {
  code: "",
  name: "",
  address: "",
  latitude: "",
  longitude: "",
  notes: "",
};

function optionalNumber(value: string) {
  return value.trim() === "" ? undefined : Number(value);
}

function SiteCard({ site }: { site: NetworkSite }) {
  return (
    <article className="noc-data-row">
      <div className="noc-data-row-leading is-site">
        <MapPinned aria-hidden="true" />
      </div>
      <div className="noc-data-row-main">
        <div className="noc-data-row-title">
          <strong>{site.name}</strong>
          <NocStatus label={site.code} tone="info" dot={false} />
        </div>
        <p>{site.address || "Alamat situs belum diisi."}</p>
        <small>
          {site.latitude !== null && site.longitude !== null
            ? `${site.latitude}, ${site.longitude}`
            : "Koordinat belum tersedia"}
          {site.notes ? ` · ${site.notes}` : ""}
        </small>
      </div>
      <span className="noc-data-row-meta">Direktori aktif</span>
    </article>
  );
}

export default function SitesPage() {
  const { session } = useSession();
  const canManage = session?.user.role === "admin" || session?.user.role === "noc";
  const { data, error, isLoading, mutate } = useSWR<SitesResponse>(
    "/api/v1/sites",
    getJson<SitesResponse>,
    { revalidateOnFocus: false },
  );
  const [form, setForm] = useState<SiteForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const sites = data?.sites ?? [];

  async function createSite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await sendJson("POST", "/api/v1/sites", {
        code: form.code,
        name: form.name,
        address: form.address || undefined,
        latitude: optionalNumber(form.latitude),
        longitude: optionalNumber(form.longitude),
        notes: form.notes || undefined,
      });
      setForm(emptyForm);
      await mutate();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Situs gagal disimpan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="noc-page noc-feature-page">
      <NocPageHeader
        title="Situs jaringan"
        description="Daftarkan lokasi fisik yang menjadi konteks aset, subnet, dan ODP."
        action={<NocStatus label={`${sites.length} situs`} tone="info" />}
      />
      <div className="noc-feature-grid is-two-column">
        <NocPanel title="Tambah situs" description="Kode otomatis disimpan dalam huruf besar.">
          {canManage ? (
            <form className="noc-feature-form" onSubmit={createSite}>
              <div className="noc-form-grid is-two">
                <div className="noc-field">
                  <Label htmlFor="site-code">Kode situs</Label>
                  <Input id="site-code" required maxLength={40} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="BALI-CORE" />
                </div>
                <div className="noc-field">
                  <Label htmlFor="site-name">Nama situs</Label>
                  <Input id="site-name" required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Kantor pusat" />
                </div>
              </div>
              <div className="noc-field">
                <Label htmlFor="site-address">Alamat</Label>
                <Input id="site-address" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} placeholder="Alamat atau patokan lapangan" />
              </div>
              <div className="noc-form-grid is-two">
                <div className="noc-field">
                  <Label htmlFor="site-latitude">Latitude <span>(opsional)</span></Label>
                  <Input id="site-latitude" inputMode="decimal" value={form.latitude} onChange={(event) => setForm({ ...form, latitude: event.target.value })} placeholder="-8.400000" />
                </div>
                <div className="noc-field">
                  <Label htmlFor="site-longitude">Longitude <span>(opsional)</span></Label>
                  <Input id="site-longitude" inputMode="decimal" value={form.longitude} onChange={(event) => setForm({ ...form, longitude: event.target.value })} placeholder="115.600000" />
                </div>
              </div>
              <div className="noc-field">
                <Label htmlFor="site-notes">Catatan</Label>
                <textarea id="site-notes" className="noc-textarea" rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Konteks operasional yang perlu diketahui tim" />
              </div>
              {formError && <NocState kind="error">{formError}</NocState>}
              <Button type="submit" disabled={saving}>
                <Plus aria-hidden="true" /> {saving ? "Menyimpan…" : "Simpan situs"}
              </Button>
            </form>
          ) : (
            <NocState kind="empty">Penambahan situs memerlukan peran admin atau NOC.</NocState>
          )}
        </NocPanel>

        <NocPanel title="Direktori situs" description="Lokasi yang sudah tersedia untuk dipilih di layar lain.">
          {isLoading && <NocState kind="loading">Memuat situs…</NocState>}
          {error && <NocState kind="error">{error instanceof ApiError ? error.message : "Situs tidak dapat dimuat."}</NocState>}
          {!isLoading && !error && sites.length === 0 && <NocState kind="empty">Belum ada situs terdaftar.</NocState>}
          <div className="noc-data-list">
            {sites.map((site) => <SiteCard key={site.id} site={site} />)}
          </div>
        </NocPanel>
      </div>
    </main>
  );
}
