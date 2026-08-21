"use client";

import { AlertTriangle, ArrowDown, ArrowUp } from "lucide-react";
import useSWR from "swr";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ApiErrorNotice from "@/components/api-error-notice";
import { NocStatus } from "@/components/noc-ui";
import StatusBadge from "@/components/status-badge";
import { useDevices } from "@/hooks/use-devices";
import { getJson } from "@/lib/api/http";
import {
  CHART_GRID_DARK,
  CHART_INK_MUTED,
  CHART_SLOT_1,
  CHART_SLOT_2,
} from "@/lib/chart-colors";
import { formatNumber } from "@/lib/noc-format";

type TrafficState = "ok" | "belum-ada-data" | "hilang";

interface TrafficInterface {
  id: string;
  ifName: string;
  label: string;
  role: "uplink" | "site" | "other";
  siteId: string | null;
  rxBps: number;
  txBps: number;
  capacityBps: number | null;
  utilizationPercent: number | null;
  sampledAt: string | null;
  state: TrafficState;
  missingSince: string | null;
}

interface TrafficLiveResponse {
  generatedAt: string;
  sampledAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
  totals: {
    uplinkRxBps: number;
    uplinkTxBps: number;
  };
  interfaces: TrafficInterface[];
}

interface TrafficSeriesPoint {
  t: string;
  rxBps: number | null;
  txBps: number | null;
}

interface TrafficSeriesResponse {
  interfaceId: string;
  label: string;
  hours: number;
  points: TrafficSeriesPoint[];
  coverage: number;
}

const TRAFFIC_REFRESH_INTERVAL_MS = 10_000;

const trafficOptions = {
  refreshInterval: TRAFFIC_REFRESH_INTERVAL_MS,
  refreshWhenHidden: true,
  revalidateOnFocus: false,
};

function fetchTrafficLive(url: string) {
  return getJson<TrafficLiveResponse>(url);
}

function fetchTrafficSeries(url: string) {
  return getJson<TrafficSeriesResponse>(url);
}

function formatTrafficRate(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${formatNumber(value)} bps`;
}

function formatTrafficTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTrafficPercent(value: number | null) {
  if (value === null) return "—";
  return `${new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 1,
  }).format(value)}%`;
}

function trafficStateMeta(state: TrafficState) {
  if (state === "ok") return { label: "Aktif", tone: "positive" as const };
  if (state === "hilang") return { label: "Hilang", tone: "danger" as const };
  return { label: "Belum ada data", tone: "neutral" as const };
}

function TrafficChart({ series }: { series: TrafficSeriesResponse }) {
  const chartData = series.points.map((point) => ({
    time: formatTrafficTime(point.t),
    rxBps: point.rxBps,
    txBps: point.txBps,
  }));

  if (chartData.length === 0) {
    return (
      <div className="noc-traffic-chart-empty">
        Belum ada titik pengukuran untuk kurva 24 jam.
      </div>
    );
  }

  return (
    <div className="noc-traffic-chart" aria-label={`Kurva trafik ${series.label}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{ top: 8, right: 10, bottom: 0, left: -10 }}
        >
          <CartesianGrid stroke={CHART_GRID_DARK} vertical={false} />
          <XAxis
            dataKey="time"
            tick={{ fill: CHART_INK_MUTED, fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            minTickGap={40}
          />
          <YAxis hide domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              fontSize: 12,
              color: "var(--popover-foreground)",
            }}
            labelFormatter={(label) => `Waktu ${String(label)}`}
            formatter={(value, name) => [
              value === null || value === undefined
                ? "Belum ada data"
                : formatTrafficRate(Number(value)),
              String(name) === "rxBps" ? "Masuk" : "Keluar",
            ]}
          />
          <Line
            type="monotone"
            dataKey="rxBps"
            name="rxBps"
            stroke={CHART_SLOT_1}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="txBps"
            name="txBps"
            stroke={CHART_SLOT_2}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function TrafficSiteRows({ interfaces }: { interfaces: TrafficInterface[] }) {
  if (interfaces.length === 0) {
    return <p className="noc-traffic-sites-empty">Belum ada interface situs.</p>;
  }

  return (
    <div className="noc-traffic-site-list">
      {interfaces.map((item) => {
        const state = trafficStateMeta(item.state);
        const hasSample = item.state === "ok";

        return (
          <div className="noc-traffic-site-row" key={item.id}>
            <div className="noc-traffic-site-copy">
              <strong>{item.label}</strong>
              <span>
                <NocStatus label={state.label} tone={state.tone} dot={false} />
                <small>
                  Utilisasi {formatTrafficPercent(hasSample ? item.utilizationPercent : null)}
                </small>
              </span>
            </div>
            <div className="noc-traffic-site-values">
              <strong className={hasSample ? "" : "is-unavailable"}>
                {hasSample
                  ? `↓ ${formatTrafficRate(item.rxBps)}`
                  : state.label}
              </strong>
              <span className={hasSample ? "" : "is-unavailable"}>
                {hasSample ? `↑ ${formatTrafficRate(item.txBps)}` : "Laju belum tersedia"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TrafficPanel() {
  const {
    data: traffic,
    error: trafficError,
    isLoading: trafficLoading,
  } = useSWR<TrafficLiveResponse>(
    "/api/v1/traffic/live",
    fetchTrafficLive,
    trafficOptions,
  );
  const primaryUplink = traffic?.interfaces.find((item) => item.role === "uplink");
  const seriesKey = primaryUplink
    ? `/api/v1/traffic/series?interfaceId=${encodeURIComponent(primaryUplink.id)}&hours=24`
    : null;
  const {
    data: series,
    error: seriesError,
    isLoading: seriesLoading,
  } = useSWR<TrafficSeriesResponse>(seriesKey, fetchTrafficSeries, trafficOptions);
  const uplinkHasSample =
    traffic?.interfaces.some((item) => item.role === "uplink" && item.state === "ok") ??
    false;
  const siteInterfaces =
    traffic?.interfaces.filter((item) => item.role === "site") ?? [];

  return (
    <section className="noc-panel noc-traffic-panel" data-testid="traffic-panel">
      <div className="noc-panel-heading">
        <div>
          <h2>Trafik jaringan</h2>
          <p>Ringkasan 24 jam terakhir</p>
        </div>
        <NocStatus label="24 jam" tone="info" dot={false} />
      </div>

      {trafficError && (
        <ApiErrorNotice
          error={trafficError}
          fallback="Data trafik belum dapat dimuat."
          className="mx-4 mt-3 rounded-lg"
        />
      )}

      <div className="noc-traffic-values">
        <div>
          <span><ArrowDown aria-hidden="true" /> Masuk</span>
          <strong>
            {traffic
              ? uplinkHasSample
                ? formatTrafficRate(traffic.totals.uplinkRxBps)
                : "Belum ada data"
              : "—"}
          </strong>
          <small>Agregat semua uplink</small>
        </div>
        <div>
          <span><ArrowUp aria-hidden="true" /> Keluar</span>
          <strong>
            {traffic
              ? uplinkHasSample
                ? formatTrafficRate(traffic.totals.uplinkTxBps)
                : "Belum ada data"
              : "—"}
          </strong>
          <small>Agregat semua uplink</small>
        </div>
      </div>

      {traffic && (
        <div
          className={`noc-traffic-freshness ${traffic.stale ? "is-stale" : "is-fresh"}`}
          data-testid="traffic-freshness"
          role={traffic.stale ? "alert" : "status"}
        >
          <span aria-hidden="true" />
          <strong>{traffic.stale ? "Data basi" : "Data aktual"}</strong>
          <small>
            {traffic.ageSeconds === null
              ? "Belum ada sampling"
              : `Sampling ${formatNumber(Math.max(0, traffic.ageSeconds))} detik lalu`}
          </small>
        </div>
      )}

      {trafficLoading && !traffic && (
        <div className="noc-traffic-inline-state">Memuat data trafik…</div>
      )}

      {seriesError && (
        <div className="noc-traffic-inline-state is-error">
          Kurva trafik belum dapat dimuat.
        </div>
      )}
      {seriesLoading && !series && !seriesError && (
        <div className="noc-traffic-inline-state">Memuat kurva trafik…</div>
      )}
      {series && !seriesError && (
        <>
          <TrafficChart series={series} />
          <div className="noc-chart-key">
            <span><i style={{ background: CHART_SLOT_1 }} /> Masuk</span>
            <span><i style={{ background: CHART_SLOT_2 }} /> Keluar</span>
            <small>Cakupan {Math.round(series.coverage * 100)}%</small>
          </div>
        </>
      )}
      {!series && !seriesLoading && !seriesError && !trafficLoading && (
        <div className="noc-traffic-inline-state">
          Belum ada uplink yang dapat digambarkan.
        </div>
      )}

      <div className="noc-traffic-sites">
        <div className="noc-traffic-sites-heading">
          <strong>Per situs</strong>
          <span>{siteInterfaces.length} interface</span>
        </div>
        <TrafficSiteRows interfaces={siteInterfaces} />
      </div>
    </section>
  );
}

export default function NetworkTelemetry() {
  const { devices, error } = useDevices();
  const incidents = devices
    .filter((device) => device.status !== "online")
    .slice(0, 4);
  const affectedAreas = new Set(incidents.map((device) => device.area)).size;

  return (
    <div className="noc-activity-grid noc-dashboard-secondary">
      {error && (
        <ApiErrorNotice
          error={error}
          fallback="Data perangkat untuk telemetri belum dapat dimuat."
          className="col-span-full rounded-lg"
        />
      )}
      <TrafficPanel />

      <section className="noc-panel noc-alert-strip">
        <AlertTriangle aria-hidden="true" />
        <div>
          <strong>Gangguan terdeteksi di {affectedAreas} lokasi</strong>
          <span>{incidents.length} perangkat membutuhkan pengecekan</span>
        </div>
        {incidents[0] && <StatusBadge status={incidents[0].status} />}
      </section>
    </div>
  );
}
