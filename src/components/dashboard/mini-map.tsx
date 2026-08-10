"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useDevices } from "@/hooks/use-devices";
import { STATUS_LABELS } from "@/lib/status";
import type { DeviceStatus } from "@/types/device";

// Leaflet accesses `window`, so the map can only render on the client.
const NetworkMap = dynamic(() => import("@/components/map/network-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-background text-sm text-muted-foreground">
      Memuat peta…
    </div>
  ),
});

export default function MiniMap() {
  const { devices } = useDevices();
  const counts = devices.reduce(
    (total, device) => {
      total[device.status] += 1;
      return total;
    },
    { online: 0, warning: 0, offline: 0 } as Record<DeviceStatus, number>,
  );

  const legend: DeviceStatus[] = ["online", "warning", "offline"];

  return (
    <section className="noc-panel noc-dashboard-map-panel" aria-labelledby="dashboard-map-title">
      <div className="noc-panel-heading">
        <div>
          <h2 id="dashboard-map-title">Site terpantau</h2>
          <p>Lokasi dan status perangkat secara real-time</p>
        </div>
        <Link
          href="/map"
          aria-label="Buka peta jaringan penuh"
        >
          Buka peta <ChevronRight aria-hidden="true" />
        </Link>
      </div>
      <div className="noc-dashboard-map-canvas">
        <NetworkMap devices={devices} filterKey="all|all" />
        <div className="noc-dashboard-map-legend" aria-label="Ringkasan status perangkat">
          <p>Status perangkat</p>
          <ul>
            {legend.map((status) => (
              <li key={status}>
                <i className={status} aria-hidden="true" />
                <span>{STATUS_LABELS[status]}</span>
                <strong>{counts[status]}</strong>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
