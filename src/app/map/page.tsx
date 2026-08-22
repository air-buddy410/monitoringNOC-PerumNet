import type { Metadata } from "next";
import FiberGeoPanel from "@/components/map/fiber-geo-panel";
import MapLegend from "@/components/map/map-legend";
import MapView from "@/components/map/map-view";

export const metadata: Metadata = {
  title: "Peta Sebaran Jaringan • PerumNet NOC",
  description:
    "Peta GIS sebaran perangkat jaringan PerumNet dengan status real-time.",
};

export default function MapPage() {
  return (
    <main className="noc-page noc-map-page">
      <div className="noc-page-intro"><div><h1>Peta jaringan</h1><p>Temukan status perangkat berdasarkan area dan jenis perangkat.</p></div></div>
      <div className="noc-map-layout">
        <div className="noc-map-canvas">
        <MapLegend />
        <MapView />
        </div>
        <FiberGeoPanel />
      </div>
    </main>
  );
}
