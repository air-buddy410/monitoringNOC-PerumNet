import type { Metadata } from "next";
import DeviceList from "@/components/dashboard/device-list";
import HealthSummary from "@/components/dashboard/health-summary";
import NetworkActivity from "@/components/dashboard/network-activity";
import NetworkTelemetry from "@/components/dashboard/network-telemetry";
import LastUpdated from "@/components/last-updated";

export const metadata: Metadata = {
  title: "Dashboard • PerumNet NOC",
  description:
    "Wallboard NOC PerumNet: ringkasan kesehatan jaringan real-time untuk layar besar ruang kontrol.",
};

export default function DashboardPage() {
  return (
    <main className="noc-page noc-dashboard-page">
      <section className="noc-page-intro">
        <div>
          <h1>Kondisi jaringan, dalam kendali.</h1>
          <p>Ringkasan kondisi jaringan PerumNet secara real-time.</p>
        </div>
        <LastUpdated />
      </section>
      <NetworkActivity />
      <section className="noc-dashboard-health" aria-label="Ringkasan kesehatan jaringan"><HealthSummary /></section>
      <NetworkTelemetry />
      <section className="noc-device-section">
        <div className="noc-section-heading"><div><h2>Perangkat yang perlu perhatian</h2><p>Urut berdasarkan dampak dan status terakhir.</p></div></div>
        <DeviceList />
      </section>
    </main>
  );
}
