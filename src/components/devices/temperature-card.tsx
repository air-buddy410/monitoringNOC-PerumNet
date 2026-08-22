"use client";

import { CircleCheck, Flame, TriangleAlert } from "lucide-react";
import type { DeviceMetricsResponse } from "@/lib/api/devices";
import {
  TEMP_THRESHOLD_CRITICAL,
  TEMP_THRESHOLD_HIGH,
  type TemperatureStatus,
} from "@/lib/mock-metrics";

// Status palette dataviz (mode gelap) — ikon + label selalu menyertai warna.
const TEMP_STATUS: Record<
  TemperatureStatus,
  { label: string; color: string; Icon: typeof CircleCheck }
> = {
  normal: { label: "Normal", color: "#0ca30c", Icon: CircleCheck },
  tinggi: { label: "Tinggi", color: "#fab219", Icon: TriangleAlert },
  kritis: { label: "Kritis", color: "#d03b3b", Icon: Flame },
};

export default function TemperatureCard({
  metrics,
}: {
  metrics: DeviceMetricsResponse | null;
}) {
  if (!metrics) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border bg-card text-sm text-muted-foreground">
        Memuat metrik…
      </div>
    );
  }

  const reading = metrics.temperature;

  if (!reading) {
    return (
      <div className="flex h-full flex-col rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-medium">Suhu Perangkat</p>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-4 text-center">
          <p className="text-sm font-medium text-muted-foreground">
            Perangkat ini tidak melaporkan sensor suhu.
          </p>
          <p className="text-xs text-muted-foreground">
            Nilai suhu dan status tidak tersedia.
          </p>
        </div>
      </div>
    );
  }

  const { label, color, Icon } = TEMP_STATUS[reading.status];

  return (
    <div className="flex h-full flex-col rounded-lg border bg-card">
      <div className="border-b px-4 py-3">
        <p className="text-sm font-medium">Suhu Perangkat</p>
      </div>
      <div className="flex flex-1 flex-col justify-center gap-3 px-4 py-4">
        <p className="text-5xl font-bold">
          {reading.celsius}
          <span className="ml-1 text-2xl font-medium text-muted-foreground">
            °C
          </span>
        </p>
        <p
          className="flex items-center gap-1.5 text-sm font-medium"
          style={{ color }}
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </p>
        <p className="text-xs text-muted-foreground">
          Ambang: Tinggi ≥ {TEMP_THRESHOLD_HIGH}°C · Kritis ≥{" "}
          {TEMP_THRESHOLD_CRITICAL}°C
        </p>
      </div>
    </div>
  );
}
