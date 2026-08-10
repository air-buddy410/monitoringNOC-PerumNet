"use client";

// Panel grafik RRD LibreNMS (proksi /api/v1/assets/:id/graph — token tidak
// pernah sampai ke browser). Menampilkan placeholder bila perangkat belum
// dipetakan ke LibreNMS.

import { useState } from "react";
import { ImageIcon, Loader2 } from "lucide-react";

const GRAPH_TYPES: { key: string; label: string }[] = [
  { key: "device_bits", label: "Trafik" },
  { key: "device_processor", label: "CPU" },
  { key: "device_mempool", label: "RAM" },
  { key: "device_uptime", label: "Uptime" },
  { key: "device_ping_perf", label: "Ping" },
];

const RANGES: { key: string; label: string }[] = [
  { key: "-24h", label: "24 Jam" },
  { key: "-7d", label: "7 Hari" },
  { key: "-30d", label: "30 Hari" },
];

export default function LibrenmsGraph({ assetId }: { assetId: string }) {
  const [type, setType] = useState("device_bits");
  const [range, setRange] = useState("-24h");
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const src = `/api/v1/assets/${encodeURIComponent(assetId)}/graph?type=${type}&from=${encodeURIComponent(range)}&width=900&height=280`;

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <p className="text-sm font-medium">Grafik RRD LibreNMS</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border p-0.5">
            {GRAPH_TYPES.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setType(item.key);
                  setFailed(false);
                  setLoaded(false);
                }}
                className={`rounded px-2.5 py-1 text-xs font-medium ${
                  type === item.key
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex rounded-md border p-0.5">
            {RANGES.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setRange(item.key);
                  setFailed(false);
                  setLoaded(false);
                }}
                className={`rounded px-2.5 py-1 text-xs font-medium ${
                  range === item.key
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="relative h-72 bg-muted/30">
        {failed ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
            <ImageIcon aria-hidden="true" className="opacity-40" />
            <p>
              Grafik belum tersedia — perangkat belum dipetakan ke LibreNMS
              atau RRD belum terbentuk.
            </p>
          </div>
        ) : (
          <>
            {!loaded && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted/30">
                <Loader2 className="animate-spin text-muted-foreground" aria-hidden="true" />
              </div>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={`Grafik RRD ${type} ${range}`}
              width={900}
              height={280}
              className="h-full w-full object-contain"
              loading="lazy"
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
            />
          </>
        )}
      </div>
    </div>
  );
}
