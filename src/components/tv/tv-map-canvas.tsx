"use client";

import { useEffect, useRef } from "react";
import { CircleMarker, MapContainer, TileLayer, useMap } from "react-leaflet";
import { latLngBounds } from "leaflet";
import type { TvSnapshot } from "@/types/tv";
import "leaflet/dist/leaflet.css";

const TILE_URL =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const DEFAULT_CENTER: [number, number] = [-8.43, 115.63];

function markerColor(status: string) {
  if (status === "offline") return "#ef716b";
  if (status === "warning") return "#f4bc52";
  return "#43d6a3";
}

function FitMarkers({
  markers,
}: {
  markers: TvSnapshot["devices"]["markers"];
}) {
  const map = useMap();
  const fittedKey = useRef("");
  const markerKey = markers.map((marker) => marker.id).join("|");

  useEffect(() => {
    if (!markerKey || markerKey === fittedKey.current) return;
    fittedKey.current = markerKey;
    const bounds = latLngBounds(
      markers.map((marker) => [marker.lat, marker.lng] as [number, number]),
    );
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 12 });
    window.setTimeout(() => map.invalidateSize(), 0);
  }, [map, markerKey, markers]);

  return null;
}

export default function TvMapCanvas({
  markers,
}: {
  markers: TvSnapshot["devices"]["markers"];
}) {
  return (
    <div className="tv-map-canvas">
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={10}
        zoomControl={false}
        attributionControl={false}
        className="tv-leaflet-map"
      >
        <TileLayer url={TILE_URL} />
        {markers.map((marker) => (
          <CircleMarker
            key={`${marker.id}-${marker.status}`}
            center={[marker.lat, marker.lng]}
            radius={7}
            pathOptions={{
              color: "#d9fffa",
              weight: 2,
              fillColor: markerColor(marker.status),
              fillOpacity: 0.9,
            }}
          />
        ))}
        <FitMarkers markers={markers} />
      </MapContainer>
      <div className="tv-map-caption">© OpenStreetMap · © CARTO</div>
      {markers.length === 0 && (
        <div className="tv-map-empty">Belum ada perangkat berkoordinat.</div>
      )}
    </div>
  );
}
