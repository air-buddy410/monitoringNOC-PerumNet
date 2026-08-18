"use client";

import { AlertTriangle, ArrowDown, ArrowUp } from "lucide-react";
import ApiErrorNotice from "@/components/api-error-notice";
import StatusBadge from "@/components/status-badge";
import { useDevices } from "@/hooks/use-devices";

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
      <section className="noc-panel noc-traffic-panel">
        <div className="noc-panel-heading">
          <div>
            <h2>Trafik jaringan</h2>
            <p>Ringkasan 24 jam terakhir</p>
          </div>
          <button type="button">24 jam terakhir</button>
        </div>
        <div className="noc-traffic-values">
          <div><span><ArrowDown /> Download</span><strong><small>Data dari LibreNMS</small></strong></div>
          <div><span><ArrowUp /> Upload</span><strong><small>belum tersedia</small></strong></div>
        </div>
        <p className="px-4 py-2 text-xs text-muted-foreground">Grafik trafik akan tersedia setelah perangkat terpetakan & RRD terbentuk di LibreNMS.</p>
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
