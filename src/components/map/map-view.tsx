"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useFiberGeo } from "@/hooks/use-fiber-geo";
import MapFilters, {
  type AreaFilter,
  type GroupFilter,
} from "@/components/map/map-filters";
import { useDevices } from "@/hooks/use-devices";

// Leaflet accesses `window`, so the map can only render on the client.
const NetworkMap = dynamic(() => import("./network-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-background text-sm text-muted-foreground">
      Memuat peta…
    </div>
  ),
});

export default function MapView() {
  const { devices } = useDevices();
  const [area, setArea] = useState<AreaFilter>("all");
  const [group, setGroup] = useState<GroupFilter>("all");
  const [fiberVisible, setFiberVisible] = useState(true);
  const [fiberCategory, setFiberCategory] = useState<"all" | "feeder" | "distribution">("all");
  const { data: fiberGeo } = useFiberGeo();

  const areas = useMemo(
    () => [...new Set(devices.map((device) => device.area))].sort(),
    [devices],
  );

  const visibleDevices = useMemo(
    () =>
      devices.filter(
        (device) =>
          (area === "all" || device.area === area) &&
          (group === "all" || device.group === group),
      ),
    [devices, area, group],
  );

  const isFiltered = area !== "all" || group !== "all";
  const visibleFiberLines = useMemo(
    () => (fiberGeo?.garis ?? []).filter((line) => fiberCategory === "all" || line.category === fiberCategory),
    [fiberCategory, fiberGeo?.garis],
  );
  const visibleFiberNodeCodes = useMemo(() => new Set(visibleFiberLines.flatMap((line) => [line.dari.code, line.ke.code])), [visibleFiberLines]);
  const visibleFiberNodes = useMemo(
    () => (fiberGeo?.simpul ?? []).filter((node) => visibleFiberNodeCodes.has(node.code)),
    [fiberGeo?.simpul, visibleFiberNodeCodes],
  );

  return (
    <>
      <MapFilters
        area={area}
        group={group}
        areas={areas}
        onAreaChange={setArea}
        onGroupChange={setGroup}
        onReset={() => {
          setArea("all");
          setGroup("all");
        }}
      />
      {isFiltered && (
        <p className="absolute right-4 top-16 z-[1000] rounded-md border bg-card/90 px-2.5 py-1 text-xs text-muted-foreground shadow backdrop-blur">
          Menampilkan{" "}
          <span className="font-medium text-foreground">
            {visibleDevices.length}
          </span>{" "}
          dari {devices.length} perangkat
        </p>
      )}
      <div className="noc-map-fiber-controls" aria-label="Kontrol lapisan fiber">
        <label><input type="checkbox" checked={fiberVisible} onChange={(event) => setFiberVisible(event.target.checked)} /> <span>Tampilkan jalur fiber</span></label>
        <select value={fiberCategory} onChange={(event) => setFiberCategory(event.target.value as typeof fiberCategory)} disabled={!fiberVisible} aria-label="Filter kategori kabel fiber">
          <option value="all">Semua kategori</option>
          <option value="feeder">Feeder</option>
          <option value="distribution">Distribution</option>
        </select>
        <div className="noc-map-fiber-key"><span><i className="is-feeder" /> Feeder</span><span><i className="is-distribution" /> Distribution</span><span><i className="is-node" /> Simpul</span></div>
      </div>
      <NetworkMap devices={visibleDevices} filterKey={`${area}|${group}|fiber:${fiberVisible}|${fiberCategory}`} fiberLines={fiberVisible ? visibleFiberLines : []} fiberNodes={fiberVisible ? visibleFiberNodes : []} />
      <p className="noc-map-attribution" aria-label="Sumber data peta">
        © OpenStreetMap · © CARTO
      </p>
    </>
  );
}
