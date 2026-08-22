"use client";

import { useEffect, useRef } from "react";
import {
  CircleMarker,
  MapContainer,
  Polyline,
  Popup,
  TileLayer,
  ZoomControl,
  useMap,
} from "react-leaflet";
import { latLngBounds } from "leaflet";
import { useTheme } from "next-themes";
import DevicePopup from "@/components/map/device-popup";
import { STATUS_COLORS } from "@/lib/status";
import type { NetworkDevice } from "@/types/device";
import type { FiberGeoLine, FiberGeoNode } from "@/types/fiber-geo";
import "leaflet/dist/leaflet.css";

const DEFAULT_CENTER: [number, number] = [-6.21, 106.845];
const DEFAULT_ZOOM = 11;

const TILE_DARK =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_LIGHT =
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
interface NetworkMapProps {
  devices: NetworkDevice[];
  /** Berubah hanya saat pilihan filter berubah — memicu auto-fit peta. */
  filterKey: string;
  fiberLines?: FiberGeoLine[];
  fiberNodes?: FiberGeoNode[];
}

// Saat filter berubah, peta terbang mulus ke cakupan titik-titik yang tampil.
function FitToVisibleGeometry({ devices, filterKey, fiberLines = [] }: NetworkMapProps) {
  const map = useMap();
  const hasFitted = useRef(false);
  const positions: Array<[number, number]> = [
    ...devices.map((device) => [device.latitude, device.longitude] as [number, number]),
    ...fiberLines.flatMap((line) => line.koordinat.map(([longitude, latitude]) => [latitude, longitude] as [number, number])),
  ];
  const geometryKey = positions.map(([latitude, longitude]) => `${latitude}:${longitude}`).join("|");
  const hasVisibleGeometry = positions.length > 0;

  useEffect(() => {
    if (!hasVisibleGeometry) return;
    const bounds = latLngBounds(positions);
    const options = { padding: [64, 64] as [number, number], maxZoom: 13 };
    // flyToBounds butuh ukuran container final; saat mount pakai fitBounds
    // instan agar tidak menghitung zoom dari layout yang belum siap (NaN).
    if (!hasFitted.current || map.getSize().x === 0) {
      hasFitted.current = true;
      map.fitBounds(bounds, options);
    } else {
      try {
        map.flyToBounds(bounds, { ...options, duration: 0.8 });
      } catch {
        map.fitBounds(bounds, options);
      }
    }
    // Sengaja hanya bereaksi pada perubahan filter, bukan refresh data 10 detik.
    // hasVisibleDevices hanya menjadi pemicu saat data pertama kali tiba atau
    // saat filter mengosongkan lalu menampilkan titik kembali.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, geometryKey, hasVisibleGeometry, map]);

  return null;
}

function fiberLineStyle(category: string) {
  if (category === "feeder") return { color: "#f4b860", weight: 5, opacity: 0.92 };
  if (category === "distribution") return { color: "#65c8e5", weight: 3, opacity: 0.9, dashArray: "8 6" };
  return { color: "#bd8de0", weight: 3, opacity: 0.88, dashArray: "3 6" };
}

function fiberNodeStyle(jenis: FiberGeoNode["jenis"]) {
  if (jenis === "OTB") return { color: "#f4b860", fillColor: "#f4b860" };
  if (jenis === "CLOSURE") return { color: "#bd8de0", fillColor: "#bd8de0" };
  if (jenis === "MS") return { color: "#ef716b", fillColor: "#ef716b" };
  return { color: "#65c8e5", fillColor: "#65c8e5" };
}

export default function NetworkMap({ devices, filterKey, fiberLines = [], fiberNodes = [] }: NetworkMapProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";

  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      zoomControl={false}
      attributionControl={false}
      className="h-full w-full bg-background"
    >
      {/* key forces the tile layer to remount when the theme switches */}
      <TileLayer
        key={isDark ? "dark" : "light"}
        url={isDark ? TILE_DARK : TILE_LIGHT}
      />
      {fiberLines.map((line) => (
        <Polyline
          key={`${line.id}-${line.category}`}
          positions={line.koordinat.map(([longitude, latitude]) => [latitude, longitude] as [number, number])}
          pathOptions={fiberLineStyle(line.category)}
        />
      ))}
      {fiberNodes.map((node) => (
        <CircleMarker
          key={`fiber-node-${node.jenis}-${node.id}`}
          center={[node.latitude, node.longitude]}
          radius={6}
          pathOptions={{ ...fiberNodeStyle(node.jenis), weight: 2, fillOpacity: 0.92 }}
        />
      ))}
      {/* key ikut status: setStyle Leaflet tidak meng-update className,
          jadi marker di-remount saat statusnya berubah */}
      {devices.map((device) => (
        <CircleMarker
          key={`${device.id}-${device.status}`}
          center={[device.latitude, device.longitude]}
          radius={8}
          pathOptions={{
            color: STATUS_COLORS[device.status],
            weight: 2,
            fillColor: STATUS_COLORS[device.status],
            fillOpacity: 0.55,
            className:
              device.status === "offline" ? "device-marker-offline" : undefined,
          }}
        >
          <Popup>
            <DevicePopup device={device} />
          </Popup>
        </CircleMarker>
      ))}
      <FitToVisibleGeometry devices={devices} fiberLines={fiberLines} filterKey={filterKey} />
      <ZoomControl position="bottomright" />
    </MapContainer>
  );
}
