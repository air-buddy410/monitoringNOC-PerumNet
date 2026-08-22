"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CircleAlert,
  Gauge,
  Radio,
  Server,
  Wifi,
} from "lucide-react";
import useSWR from "swr";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import TvMap from "@/components/tv/tv-map";
import { fetchTvSnapshot, TvSnapshotError } from "@/lib/tv-client";
import { formatBitrate, formatDateTime, formatNumber } from "@/lib/noc-format";
import type { TvSnapshot, TvTrafficInterface } from "@/types/tv";

const TV_REFRESH_INTERVAL_MS = 10_000;

const tvOptions = {
  refreshInterval: TV_REFRESH_INTERVAL_MS,
  refreshWhenHidden: true,
  revalidateOnFocus: false,
  keepPreviousData: true,
  errorRetryInterval: TV_REFRESH_INTERVAL_MS,
};

function formatChartTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(status: string) {
  if (status === "online") return "Online";
  if (status === "warning") return "Peringatan";
  if (status === "offline") return "Offline";
  if (status === "belum-ada-data") return "Belum ada data";
  if (status === "hilang") return "Hilang";
  return status;
}

function severityClass(severity: string) {
  if (severity === "critical") return "is-critical";
  if (severity === "warning") return "is-warning";
  return "is-info";
}

function TrafficBars({ interfaces }: { interfaces: TvTrafficInterface[] }) {
  const visibleInterfaces = interfaces.slice(0, 6);
  const maximum = Math.max(
    1,
    ...visibleInterfaces.flatMap((item) => [item.rxBps, item.txBps]),
  );

  if (interfaces.length === 0) {
    return <p className="tv-inline-empty">Belum ada interface trafik.</p>;
  }

  return (
    <div className="tv-traffic-bars" aria-label="Laju interface saat ini">
      {visibleInterfaces.map((item) => {
        const hasSample = item.state === "ok";
        const rxWidth = hasSample ? Math.max(2, (item.rxBps / maximum) * 100) : 0;
        const txWidth = hasSample ? Math.max(2, (item.txBps / maximum) * 100) : 0;
        return (
          <div className="tv-traffic-bar-row" key={item.id}>
            <div className="tv-traffic-bar-heading">
              <strong>{item.label}</strong>
              <span>{hasSample ? item.role : statusLabel(item.state)}</span>
            </div>
            <div className="tv-traffic-bar-line">
              <span className="tv-traffic-bar-key is-rx"><ArrowDown aria-hidden="true" /> Masuk</span>
              <div className="tv-traffic-bar-track"><i style={{ width: `${rxWidth}%` }} /></div>
              <b>{hasSample ? formatBitrate(item.rxBps) : "—"}</b>
            </div>
            <div className="tv-traffic-bar-line">
              <span className="tv-traffic-bar-key is-tx"><ArrowUp aria-hidden="true" /> Keluar</span>
              <div className="tv-traffic-bar-track is-tx"><i style={{ width: `${txWidth}%` }} /></div>
              <b>{hasSample ? formatBitrate(item.txBps) : "—"}</b>
            </div>
          </div>
        );
      })}
      {interfaces.length > visibleInterfaces.length && (
        <small className="tv-card-note">Menampilkan {visibleInterfaces.length} dari {interfaces.length} interface.</small>
      )}
    </div>
  );
}

function PppoeTrend({ trend }: { trend: TvSnapshot["pppoe"]["trend"] }) {
  if (trend.length === 0) {
    return <p className="tv-inline-empty">Belum ada histori polling PPPoE.</p>;
  }

  const chartData = trend.map((point) => ({
    time: formatChartTime(point.t),
    count: point.count,
  }));

  return (
    <div className="tv-pppoe-chart" aria-label="Tren sesi PPPoE 24 jam">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 5, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="#b2e0d833" vertical={false} />
          <XAxis dataKey="time" tick={{ fill: "#9bc3bf", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={35} />
          <YAxis hide domain={["auto", "auto"]} />
          <Line type="monotone" dataKey="count" stroke="#60dfb4" strokeWidth={3} dot={false} isAnimationActive={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function TrafficCard({ traffic }: { traffic: TvSnapshot["traffic"] }) {
  return (
    <section className="tv-card tv-traffic-card" aria-labelledby="tv-traffic-heading">
      <div className="tv-card-heading">
        <div><span className="tv-eyebrow"><Gauge aria-hidden="true" /> Trafik uplink</span><h2 id="tv-traffic-heading">Laju saat ini</h2></div>
        <span className={`tv-data-chip ${traffic.stale ? "is-stale" : "is-fresh"}`}>{traffic.stale ? "BASI" : "SEGAR"}</span>
      </div>
      <div className="tv-traffic-totals">
        <div><span><ArrowDown aria-hidden="true" /> Masuk</span><strong>{formatBitrate(traffic.totals.uplinkRxBps)}</strong></div>
        <div><span><ArrowUp aria-hidden="true" /> Keluar</span><strong>{formatBitrate(traffic.totals.uplinkTxBps)}</strong></div>
      </div>
      <div className="tv-freshness-line">
        <span className={traffic.stale ? "is-stale" : "is-fresh"} />
        <strong>{traffic.stale ? "Data trafik perlu diperiksa" : "Data trafik terpantau"}</strong>
        <small>{traffic.ageSeconds === null ? "Belum ada sampel" : `${formatNumber(traffic.ageSeconds)} detik lalu`} · {formatDateTime(traffic.sampledAt)}</small>
      </div>
      <TrafficBars interfaces={traffic.interfaces} />
      <p className="tv-card-note">Trafik hanya menampilkan sampel terbaru dari snapshot TV.</p>
    </section>
  );
}

function DeviceCard({ devices }: { devices: TvSnapshot["devices"] }) {
  return (
    <section className="tv-card tv-device-card" aria-labelledby="tv-device-heading">
      <div className="tv-card-heading">
        <div><span className="tv-eyebrow"><Server aria-hidden="true" /> Perangkat</span><h2 id="tv-device-heading">Kesehatan jaringan</h2></div>
        <strong className="tv-big-number">{formatNumber(devices.total)}</strong>
      </div>
      <div className="tv-device-stats">
        <div className="is-online"><span>Online</span><strong>{formatNumber(devices.online)}</strong></div>
        <div className="is-warning"><span>Peringatan</span><strong>{formatNumber(devices.warning)}</strong></div>
        <div className="is-offline"><span>Offline</span><strong>{formatNumber(devices.offline)}</strong></div>
      </div>
      <div className="tv-device-summary"><Wifi aria-hidden="true" /> {formatNumber(devices.markers.length)} perangkat memiliki penanda peta</div>
      <div className="tv-status-legend"><span><i className="is-online" /> Online</span><span><i className="is-warning" /> Peringatan</span><span><i className="is-offline" /> Offline</span></div>
    </section>
  );
}

function PppoeCard({ pppoe }: { pppoe: TvSnapshot["pppoe"] }) {
  const isHealthy = pppoe.lastRunStatus === "SUCCESS";
  return (
    <section className="tv-card tv-pppoe-card" aria-labelledby="tv-pppoe-heading">
      <div className="tv-card-heading">
        <div><span className="tv-eyebrow"><Radio aria-hidden="true" /> PPPoE</span><h2 id="tv-pppoe-heading">Sesi aktif</h2></div>
        <span className={`tv-data-chip ${isHealthy ? "is-fresh" : "is-stale"}`}>{pppoe.lastRunStatus ?? "BELUM ADA DATA"}</span>
      </div>
      <strong className="tv-hero-number">{formatNumber(pppoe.current)}</strong>
      <span className="tv-muted-label">Sesi dari polling terakhir</span>
      <PppoeTrend trend={pppoe.trend} />
      <p className="tv-card-note">Tren 24 jam · ±{formatNumber(pppoe.trend.length)} titik hasil polling.</p>
    </section>
  );
}

function OutageCard({ outages }: { outages: TvSnapshot["outages"] }) {
  return (
    <section className="tv-card tv-outage-card" aria-labelledby="tv-outage-heading">
      <div className="tv-card-heading"><div><span className="tv-eyebrow"><AlertTriangle aria-hidden="true" /> Padam</span><h2 id="tv-outage-heading">Ringkasan gangguan</h2></div><strong className="tv-hero-number is-small">{formatNumber(outages.padamTotal)}</strong></div>
      <div className="tv-outage-summary"><span>tersebar <b>{formatNumber(outages.padamTersebar)}</b></span><span>aktif <b>{formatNumber(outages.aktifTotal)}</b></span></div>
      <div className="tv-outage-list">
        {outages.clusters.length === 0 ? <p className="tv-inline-empty">Tidak ada gerombolan padam.</p> : outages.clusters.slice(0, 4).map((cluster) => (
          <div className="tv-outage-row" key={`${cluster.level}-${cluster.id}`}><span className="tv-outage-level">{cluster.level}</span><strong>{cluster.name}</strong><b>{formatNumber(cluster.padam)}/{formatNumber(cluster.total)}</b></div>
        ))}
      </div>
    </section>
  );
}

function IncidentsCard({ incidents }: { incidents: TvSnapshot["incidents"] }) {
  const visibleIncidents = incidents.slice(0, 5);
  return (
    <section className="tv-card tv-incidents-card" aria-labelledby="tv-incidents-heading">
      <div className="tv-card-heading"><div><span className="tv-eyebrow"><CircleAlert aria-hidden="true" /> Insiden</span><h2 id="tv-incidents-heading">Insiden aktif</h2></div><strong className="tv-hero-number is-small">{formatNumber(incidents.length)}</strong></div>
      {visibleIncidents.length === 0 ? <p className="tv-inline-empty">Tidak ada insiden aktif.</p> : <div className="tv-incident-list">{visibleIncidents.map((incident) => <div className="tv-incident-row" key={incident.id}><i className={severityClass(incident.severity)} /><div><strong>{incident.deviceName}</strong><span>{incident.message}</span></div><time dateTime={incident.triggeredAt}>{formatChartTime(incident.triggeredAt)}</time></div>)}</div>}
      {incidents.length > visibleIncidents.length && <p className="tv-card-note">Menampilkan {visibleIncidents.length} dari {incidents.length} insiden.</p>}
    </section>
  );
}

function ConnectionState({
  title,
  message,
  isError = false,
}: {
  title: string;
  message: string;
  isError?: boolean;
}) {
  return (
    <main className="tv-connection-state" role={isError ? "alert" : undefined}>
      <div className="tv-connection-mark"><Radio aria-hidden="true" /></div>
      <strong>{title}</strong>
      <p>{message}</p>
      <small>Wallboard mencoba membaca snapshot setiap 10 detik.</small>
    </main>
  );
}

export default function TvWallboard() {
  const { data, error, isLoading } = useSWR<TvSnapshot, TvSnapshotError>(
    "/api/v1/tv/snapshot",
    () => fetchTvSnapshot(),
    tvOptions,
  );

  if (!data) {
    if (isLoading) {
      return <ConnectionState title="Menyiapkan wallboard NOC" message="Memeriksa koneksi layar TV…" />;
    }
    return <ConnectionState title="Layar TV belum tersambung" message={error?.message ?? "Snapshot wallboard belum tersedia."} isError />;
  }

  return (
    <main className="tv-wallboard">
      <header className="tv-wallboard-header">
        <div className="tv-brand-lockup"><span className="tv-brand-mark">PN</span><div><strong>PerumNet NOC</strong><span>WALLBOARD OPERASIONAL</span></div></div>
        <div className="tv-header-meta"><span className={`tv-live-indicator ${data.traffic.stale ? "is-stale" : "is-live"}`}><i />{data.traffic.stale ? "TRAFFIC BASI" : "LIVE"}</span><span>Dibuat {formatDateTime(data.generatedAt)}</span></div>
      </header>
      {error && <div className="tv-refresh-warning" role="status"><AlertTriangle aria-hidden="true" /> <span>Snapshot terbaru gagal dimuat. Menampilkan data terakhir yang berhasil; layar akan mencoba lagi otomatis.</span></div>}
      <div className="tv-wallboard-grid">
        <TrafficCard traffic={data.traffic} />
        <DeviceCard devices={data.devices} />
        <PppoeCard pppoe={data.pppoe} />
        <section className="tv-card tv-map-card" aria-labelledby="tv-map-heading">
          <div className="tv-card-heading"><div><span className="tv-eyebrow"><Wifi aria-hidden="true" /> Peta perangkat</span><h2 id="tv-map-heading">Sebaran penanda</h2></div><span className="tv-map-count">{formatNumber(data.devices.markers.length)} titik</span></div>
          <TvMap markers={data.devices.markers} />
        </section>
        <div className="tv-wallboard-side-stack"><OutageCard outages={data.outages} /><IncidentsCard incidents={data.incidents} /></div>
      </div>
    </main>
  );
}
