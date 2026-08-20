"use client";

import { useEffect, useRef } from "react";
import {
  CircleMarker,
  MapContainer,
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
}

// Saat filter berubah, peta terbang mulus ke cakupan titik-titik yang tampil.
function FitToVisibleDevices({ devices, filterKey }: NetworkMapProps) {
  const map = useMap();
  const hasFitted = useRef(false);
  const hasVisibleDevices = devices.length > 0;

  useEffect(() => {
    if (!hasVisibleDevices) return;
    const bounds = latLngBounds(
      devices.map((device) => [device.latitude, device.longitude]),
    );
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
  }, [filterKey, hasVisibleDevices, map]);

  return null;
}

export default function NetworkMap({ devices, filterKey }: NetworkMapProps) {
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
      <FitToVisibleDevices devices={devices} filterKey={filterKey} />
      <ZoomControl position="bottomright" />
    </MapContainer>
  );
}
