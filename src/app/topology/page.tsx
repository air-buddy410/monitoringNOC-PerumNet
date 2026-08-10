import type { Metadata } from "next";
import TopologyView from "@/components/topology/topology-view";

export const metadata: Metadata = {
  title: "Topologi Jaringan • PerumNet NOC",
  description:
    "Diagram topologi jaringan PerumNet: mode lihat, edit manual, dan review discovery LibreNMS.",
};

export default function TopologyPage() {
  return (
    <main className="noc-page noc-topology-page">
      <TopologyView />
    </main>
  );
}
