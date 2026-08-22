"use client";

import { CircleCheck, CircleX, Zap } from "lucide-react";
import type { OltOpticsResponse } from "@/lib/api/devices";
import ReportSourceBanner from "@/components/reports/report-source-banner";
import {
  RX_POWER_CRITICAL,
  RX_POWER_LOW,
  type OnuStatus,
} from "@/lib/mock-metrics";

// Status palette dataviz — ikon + label selalu menyertai warna.
const ONU_STATUS: Record<
  OnuStatus,
  { label: string; color: string; Icon: typeof CircleCheck }
> = {
  online: { label: "Online", color: "#0ca30c", Icon: CircleCheck },
  offline: { label: "Offline", color: "#d03b3b", Icon: CircleX },
  dying_gasp: { label: "Dying Gasp", color: "#ec835a", Icon: Zap },
};

function rxPowerColor(rxPower: number): string | undefined {
  if (rxPower < RX_POWER_CRITICAL) return "#d03b3b";
  if (rxPower < RX_POWER_LOW) return "#fab219";
  return undefined; // normal — pakai warna teks biasa
}

function formatTxPower(txPower: number | null) {
  return txPower === null ? "—" : String(txPower);
}

export default function OpticalHealth({
  optics,
}: {
  optics: OltOpticsResponse | null;
}) {
  if (!optics) {
    return (
      <div className="rounded-lg border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        Data optik belum tersedia untuk perangkat ini.
      </div>
    );
  }

  const ports = optics.ports;

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <p className="text-sm font-medium">
          Kesehatan Optik OLT — SFP PON &amp; ONU
        </p>
        <p className="text-xs text-muted-foreground">
          Rx rendah &lt; {RX_POWER_LOW} dBm · kritis &lt; {RX_POWER_CRITICAL}{" "}
          dBm
        </p>
      </div>
      <div className="px-4 pt-4">
        <ReportSourceBanner source={optics.sumber} />
      </div>
      {ports.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          {optics.catatan ?? "Belum ada data optik."}
        </p>
      )}
      <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-4">
        {ports.map((pon) => (
          <div key={pon.port} className="rounded-md border bg-background/40">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <p className="font-mono text-xs font-medium">{pon.port}</p>
              <p className="text-[11px] text-muted-foreground">
                SFP{" "}
                <span
                  className="font-medium"
                  style={{ color: pon.sfpUp ? "#0ca30c" : "#d03b3b" }}
                >
                  {pon.sfpUp ? "Up" : "Down"}
                </span>{" "}
                · Tx{" "}
                <span className="font-medium tabular-nums text-foreground">
                  {formatTxPower(pon.txPower)}
                </span>{" "}
                dBm
              </p>
            </div>
            <ul className="divide-y divide-border/60">
              {pon.onus.map((onu) => {
                const { label, color, Icon } = ONU_STATUS[onu.status];
                return (
                  <li
                    key={onu.id}
                    className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
                  >
                    <span className="font-mono">{onu.id}</span>
                    <span className="flex items-center gap-3">
                      <span
                        className="tabular-nums"
                        style={{ color: rxPowerColor(onu.rxPower) }}
                      >
                        {onu.rxPower.toFixed(1)} dBm
                      </span>
                      <span
                        className="flex w-24 items-center gap-1 font-medium"
                        style={{ color }}
                      >
                        <Icon className="size-3.5 shrink-0" aria-hidden />
                        {label}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
