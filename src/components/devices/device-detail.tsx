"use client";

import Link from "next/link";
import CpuRamChart from "@/components/devices/cpu-ram-chart";
import HistoryChart from "@/components/devices/history-chart";
import LibrenmsGraph from "@/components/devices/librenms-graph";
import OpticalHealth from "@/components/devices/optical-health";
import PortBandwidth from "@/components/devices/port-bandwidth";
import TemperatureCard from "@/components/devices/temperature-card";
import StatusBadge from "@/components/status-badge";
import { useDeviceLive } from "@/hooks/use-device-live";

export default function DeviceDetail({ deviceId }: { deviceId: string }) {
  const { data: live, error, isLoading } = useDeviceLive(deviceId);
  const device = live?.device;

  if (isLoading && !device) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        Memuat data perangkat…
      </div>
    );
  }

  if (!live || !device) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <p role="alert">
          {error instanceof Error
            ? error.message
            : `Perangkat dengan ID ${deviceId} tidak ditemukan.`}
        </p>
        <Link href="/dashboard" className="text-foreground hover:underline">
          ← Kembali ke Dasbor
        </Link>
      </div>
    );
  }

  return (
    <>
      {error && (
        <p
          role="alert"
          className="border-b border-destructive/30 bg-destructive/10 px-6 py-2 text-xs text-destructive"
        >
          Gagal memperbarui data live: {error instanceof Error ? error.message : "coba lagi nanti."}
        </p>
      )}
      {/* Header perangkat */}
      <header className="border-b px-6 py-4">
        <Link
          href="/dashboard"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Kembali ke Dasbor
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">
            {device.name}
          </h1>
          <StatusBadge status={device.status} />
        </div>
        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <div className="flex gap-1.5">
            <dt>Jenis:</dt>
            <dd className="text-foreground">{device.group}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Area:</dt>
            <dd className="text-foreground">{device.area}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>IP Address:</dt>
            <dd className="font-mono text-foreground">{device.ip}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>ID Monitoring:</dt>
            <dd className="font-mono text-foreground">{device.id}</dd>
          </div>
        </dl>
      </header>

      {/* Panel metrik — diisi bertahap oleh task berikutnya */}
      <section className="grid flex-1 content-start gap-4 overflow-y-auto px-6 py-6 lg:grid-cols-3">
        <div className="h-72 lg:col-span-2">
          <CpuRamChart metrics={live.metrics} />
        </div>
        <div className="h-72">
          <TemperatureCard metrics={live.metrics} />
        </div>
        <div className="lg:col-span-3">
          <PortBandwidth metrics={live.metrics} />
        </div>
        {device.group === "OLT" && (
          <div className="lg:col-span-3">
            <OpticalHealth optics={live.optics} />
          </div>
        )}
        <div className="lg:col-span-3">
          <HistoryChart deviceId={device.id} />
        </div>
        <div className="lg:col-span-3">
          <LibrenmsGraph assetId={device.id} />
        </div>
      </section>
    </>
  );
}
