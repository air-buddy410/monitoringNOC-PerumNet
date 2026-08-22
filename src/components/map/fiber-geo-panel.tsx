"use client";

import { Cable, CircleHelp } from "lucide-react";
import { NocState, NocStatus } from "@/components/noc-ui";
import { useFiberGeo } from "@/hooks/use-fiber-geo";
import { formatNumber, formatPanjang } from "@/lib/noc-format";
import { ApiError } from "@/lib/api/http";
import type { FiberGeoLine } from "@/types/fiber-geo";

function categoryLabel(category: string) {
  if (category === "feeder") return "Feeder";
  if (category === "distribution") return "Distribution";
  if (category === "backbone") return "Backbone";
  if (category === "dropcore") return "Drop core";
  return category;
}

function totalLengthLabel(lines: FiberGeoLine[]) {
  const measured = lines.filter((line) => line.lengthM !== null);
  if (measured.length === 0) return "Belum diukur";
  const total = measured.reduce((sum, line) => sum + (line.lengthM ?? 0), 0);
  return formatPanjang(total, measured.length === lines.length);
}

export default function FiberGeoPanel() {
  const { data, error, isLoading } = useFiberGeo();

  return (
    <aside className="noc-map-fiber-panel" aria-label="Status jalur fiber">
      <div className="noc-map-fiber-panel-heading"><div><span><Cable aria-hidden="true" /> Jalur fiber</span><h2>Belum bisa digambar</h2></div>{data && <NocStatus label={`${formatNumber(data.ringkas.tergambar)} garis`} tone="info" />}</div>
      <p className="noc-map-fiber-panel-intro">Garis diturunkan dari titik terminasi dan closure. Kabel tanpa geometri tidak ditebakkan ke peta.</p>
      {isLoading && <NocState kind="loading">Memuat geometri fiber…</NocState>}
      {error && <NocState kind="error">{error instanceof ApiError ? error.message : "Geometri fiber tidak dapat dimuat."}</NocState>}
      {!isLoading && !error && data && (
        <>
          <div className="noc-map-fiber-summary"><div><strong>{formatNumber(data.ringkas.kabelAktif)}</strong><span>Kabel aktif</span></div><div><strong>{formatNumber(data.ringkas.tergambar)}</strong><span>Tergambar</span></div><div><strong>{formatNumber(data.ringkas.tanpaGeometri)}</strong><span>Belum bisa</span></div></div>
          {data.tanpaGeometri.length === 0 ? <div className="noc-map-fiber-empty"><CircleHelp aria-hidden="true" /><span>Semua kabel aktif memiliki dua jangkar berkoordinat.</span></div> : <div className="noc-map-fiber-unavailable"><strong>Perlu dilengkapi</strong>{data.tanpaGeometri.map((item) => <article key={item.id}><div><b>{item.code}</b><NocStatus label={categoryLabel(item.category)} tone="neutral" dot={false} /></div><p>{item.alasan}</p></article>)}</div>}
          <div className="noc-map-fiber-legend"><span><i className="is-feeder" /> Feeder · garis tebal</span><span><i className="is-distribution" /> Distribution · garis putus</span><span><i className="is-node" /> Simpul · jangkar</span></div>
          <p className="noc-map-fiber-note">Panjang garis: {totalLengthLabel(data.garis)} · total garis yang sudah punya geometri.</p>
        </>
      )}
    </aside>
  );
}
