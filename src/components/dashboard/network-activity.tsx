"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import MiniMap from "@/components/dashboard/mini-map";
import { useDevices } from "@/hooks/use-devices";

export default function NetworkActivity() {
  const { devices } = useDevices();
  const incidents = devices
    .filter((device) => device.status !== "online")
    .slice(0, 4);

  return (
    <>
      <div className="noc-command-grid">
        <MiniMap />
        <section className="noc-panel noc-incidents-panel">
          <div className="noc-panel-heading">
            <div>
              <h2>Insiden aktif</h2>
              <p>Prioritas penanganan tim NOC</p>
            </div>
            <Link href="/notifications">Lihat semua <ChevronRight /></Link>
          </div>
          <div className="noc-incident-list">
            {incidents.length === 0 ? (
              <div className="noc-empty-state">Tidak ada insiden aktif saat ini.</div>
            ) : (
              incidents.map((device) => (
                <Link href={`/devices/${device.id}`} className="noc-incident-row" key={device.id}>
                  <span className={`noc-severity-dot ${device.status}`} />
                  <div>
                    <strong>{device.status === "offline" ? "Kritis" : "Perhatian"}</strong>
                    <span>{device.name}</span>
                    <small>{device.area}</small>
                  </div>
                  <ChevronRight aria-hidden="true" />
                </Link>
              ))
            )}
          </div>
        </section>
      </div>
    </>
  );
}
