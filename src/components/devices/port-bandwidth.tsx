"use client";

import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DeviceMetricsResponse } from "@/lib/api/devices";
import { CHART_SLOT_1, CHART_SLOT_2 } from "@/lib/chart-colors";

const SERIES = {
  download: { label: "Download", color: CHART_SLOT_1 },
  upload: { label: "Upload", color: CHART_SLOT_2 },
};

export default function PortBandwidth({
  metrics,
}: {
  metrics: DeviceMetricsResponse;
}) {
  const { ports } = metrics;

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <p className="text-sm font-medium">Bandwidth per Port</p>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {(["download", "upload"] as const).map((key) => (
            <span key={key} className="flex items-center gap-1.5">
              <span
                className="inline-block size-2 rounded-full"
                style={{ backgroundColor: SERIES[key].color }}
              />
              {SERIES[key].label}
            </span>
          ))}
        </div>
      </div>
      <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-4">
        {ports.map((port) => (
          <div key={port.port} className="rounded-md border bg-background/40">
            <div className="flex items-baseline justify-between gap-2 px-3 pt-2.5">
              <p className="font-mono text-xs font-medium">{port.port}</p>
              <p className="text-[11px] text-muted-foreground">
                <span
                  className="font-medium tabular-nums"
                  style={{ color: SERIES.download.color }}
                >
                  ↓ {port.currentDownload}
                </span>{" "}
                <span
                  className="ml-1.5 font-medium tabular-nums"
                  style={{ color: SERIES.upload.color }}
                >
                  ↑ {port.currentUpload}
                </span>{" "}
                Mbps
              </p>
            </div>
            <div className="h-20 px-1 pb-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={port.series}
                  margin={{ top: 8, right: 6, bottom: 2, left: 6 }}
                >
                  <XAxis dataKey="time" hide />
                  <YAxis hide domain={[0, 1000]} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius)",
                      fontSize: 12,
                      color: "var(--popover-foreground)",
                    }}
                    formatter={(value, name) => [
                      `${value} Mbps`,
                      String(name),
                    ]}
                  />
                  <Line
                    type="monotone"
                    dataKey="download"
                    name={SERIES.download.label}
                    stroke={SERIES.download.color}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="upload"
                    name={SERIES.upload.label}
                    stroke={SERIES.upload.color}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
