"use client";

import dynamic from "next/dynamic";
import type { TvSnapshot } from "@/types/tv";

const TvMapCanvas = dynamic(() => import("./tv-map-canvas"), {
  ssr: false,
  loading: () => <div className="tv-map-loading">Memuat peta perangkat…</div>,
});

export default function TvMap({
  markers,
}: {
  markers: TvSnapshot["devices"]["markers"];
}) {
  return <TvMapCanvas markers={markers} />;
}
