"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DeviceMetricsResponse } from "@/lib/api/devices";
import {
  CHART_GRID_DARK as GRID_DARK,
  CHART_INK_MUTED as INK_MUTED,
  CHART_SLOT_1,
  CHART_SLOT_2,
} from "@/lib/chart-colors";

// Slot kategorikal 1 & 2 (mode gelap) dari palet referensi dataviz —
// pasangan adjacent tervalidasi aman CVD.
const SERIES = {
  cpu: { label: "CPU", color: CHART_SLOT_1 },
  ram: { label: "RAM", color: CHART_SLOT_2 },
};

function formatUsage(value: number | null) {
  return value === null ? "—" : `${value}%`;
}

export default function CpuRamChart({
  metrics,
}: {
  metrics: DeviceMetricsResponse;
}) {
  const data = metrics.usage;
  const latest = data[data.length - 1];

  if (!latest) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border bg-card text-sm text-muted-foreground">
        Memuat metrik…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <p className="text-sm font-medium">CPU &amp; RAM</p>
        <div className="flex items-center gap-4 text-xs">
          {(["cpu", "ram"] as const).map((key) => (
            <span key={key} className="flex items-center gap-1.5">
              <span
                className="inline-block size-2 rounded-full"
                style={{ backgroundColor: SERIES[key].color }}
              />
              <span className="text-muted-foreground">{SERIES[key].label}</span>
              <span className="font-medium tabular-nums">
                {formatUsage(latest[key])}
              </span>
            </span>
          ))}
        </div>
      </div>
      <div className="min-h-52 flex-1 px-2 py-3">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 4, right: 12, bottom: 0, left: -16 }}
          >
            <CartesianGrid stroke={GRID_DARK} vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fill: INK_MUTED, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              minTickGap={40}
            />
            <YAxis
              domain={[0, 100]}
              unit="%"
              tick={{ fill: INK_MUTED, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                fontSize: 12,
                color: "var(--popover-foreground)",
              }}
              formatter={(value, name) => [
                value == null ? "Belum ada pengukuran" : `${value}%`,
                String(name),
              ]}
            />
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              formatter={(value: string) => (
                <span style={{ color: INK_MUTED }}>{value}</span>
              )}
            />
            <Line
              type="monotone"
              dataKey="cpu"
              name={SERIES.cpu.label}
              stroke={SERIES.cpu.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="ram"
              name={SERIES.ram.label}
              stroke={SERIES.ram.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
