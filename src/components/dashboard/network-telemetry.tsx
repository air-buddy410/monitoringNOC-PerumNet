"use client";

import { AlertTriangle, ArrowDown, ArrowUp } from "lucide-react";
import StatusBadge from "@/components/status-badge";
import { useDevices } from "@/hooks/use-devices";

export default function NetworkTelemetry() {
  const { devices } = useDevices();
  const incidents = devices
    .filter((device) => device.status !== "online")
    .slice(0, 4);
  const affectedAreas = new Set(incidents.map((device) => device.area)).size;

  return (
    <div className="noc-activity-grid noc-dashboard-secondary">
      <section className="noc-panel noc-traffic-panel">
        <div className="noc-panel-heading">
          <div>
            <h2>Trafik jaringan</h2>
            <p>Ringkasan 24 jam terakhir</p>
          </div>
          <button type="button">24 jam terakhir</button>
        </div>
        <div className="noc-traffic-values">
          <div><span><ArrowDown /> Download</span><strong>2,34 <small>Gbps</small></strong></div>
          <div><span><ArrowUp /> Upload</span><strong>1,12 <small>Gbps</small></strong></div>
        </div>
        <svg className="noc-sparkline" viewBox="0 0 470 142" role="img" aria-label="Grafik trafik jaringan">
          <path d="M5 93 C35 55 50 83 81 64 S120 92 146 72 S195 37 220 73 S270 99 294 61 S346 41 372 76 S424 94 465 45" fill="none" stroke="currentColor" strokeWidth="4" />
          <path d="M5 115 C31 95 56 121 81 101 S122 133 146 111 S191 86 220 117 S268 128 294 105 S342 98 372 112 S421 127 465 91" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="6 7" opacity=".45" />
        </svg>
        <div className="noc-chart-key"><span><i /> Download</span><span><i /> Upload</span></div>
      </section>

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
