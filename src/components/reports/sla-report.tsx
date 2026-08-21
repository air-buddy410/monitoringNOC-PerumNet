"use client";

import useSWR from "swr";
import ApiErrorNotice from "@/components/api-error-notice";
import { CircleCheck, TriangleAlert } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getJson } from "@/lib/api/http";
import { formatDowntime } from "@/lib/mock-reports";
import type { DeviceGroup } from "@/types/device";

interface SlaRow {
  deviceId: string;
  deviceName: string;
  group: DeviceGroup;
  area: string;
  uptimePercent: number;
  downtimeMinutes: number;
  incidents: number;
  meetsTarget: boolean;
}

interface SlaResponse {
  period: string;
  targetPercent: number;
  rows: SlaRow[];
  /** `belum-ada-data` bukan nol — lihat §7 HANDOFF dan tugas T-23. */
  source?: "terukur" | "fixture" | "belum-ada-data";
  summary: { devices: number; averageUptime: number | null; belowTarget: number };
}

export default function SlaReport({ period }: { period: string }) {
  const { data, error } = useSWR(
    `/api/reports/sla?period=${period}`,
    getJson<SlaResponse>,
    { revalidateOnFocus: false },
  );
  const rows = data?.rows ?? [];

  if (error) {
    return (
      <ApiErrorNotice
        error={error}
        fallback="Laporan SLA tidak dapat dimuat."
        className="rounded-lg bg-card py-8 text-center"
      />
    );
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <p className="text-sm font-medium">
          Laporan Ketersediaan SLA{" "}
          <span className="text-xs font-normal text-muted-foreground">
            target ≥ {data?.targetPercent ?? 99.5}%
          </span>
        </p>
        <p className="text-xs text-muted-foreground">
          {data ? (
            <>
              Rata-rata uptime{" "}
              <span className="font-medium tabular-nums text-foreground">
                {data.summary.averageUptime === null
                  ? "—"
                  : `${data.summary.averageUptime}%`}
              </span>{" "}
              · {data.summary.belowTarget} perangkat di bawah target
            </>
          ) : (
            "Memuat laporan…"
          )}
        </p>
      </div>
      <div className="divide-y md:hidden">
        {rows.map((row) => (
          <article key={row.deviceId} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">{row.deviceName}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.group} · {row.area}
                </p>
              </div>
              <span
                className={`text-sm font-semibold tabular-nums ${
                  row.meetsTarget ? "text-primary" : "text-[#d03b3b]"
                }`}
              >
                {row.uptimePercent.toFixed(2)}%
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
              <span>Downtime<br /><b className="text-foreground">{formatDowntime(row.downtimeMinutes)}</b></span>
              <span>Insiden<br /><b className="text-foreground">{row.incidents}</b></span>
              <span className="text-right">SLA<br /><b className={row.meetsTarget ? "text-[#0ca30c]" : "text-[#d03b3b]"}>{row.meetsTarget ? "Terpenuhi" : "Di bawah"}</b></span>
            </div>
          </article>
        ))}
      </div>
      <div className="hidden md:block">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Perangkat</TableHead>
            <TableHead>Jenis</TableHead>
            <TableHead>Area</TableHead>
            <TableHead className="text-right">Uptime</TableHead>
            <TableHead className="text-right">Downtime</TableHead>
            <TableHead className="text-right">Insiden</TableHead>
            <TableHead className="text-right">Status SLA</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.deviceId}>
              <TableCell className="text-xs font-medium">
                {row.deviceName}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {row.group}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {row.area}
              </TableCell>
              <TableCell
                className={`text-right text-xs font-semibold tabular-nums ${
                  row.meetsTarget ? "" : "text-[#d03b3b]"
                }`}
              >
                {row.uptimePercent.toFixed(2)}%
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                {formatDowntime(row.downtimeMinutes)}
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                {row.incidents}
              </TableCell>
              <TableCell className="text-right">
                {row.meetsTarget ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-[#0ca30c]">
                    <CircleCheck className="size-3.5" aria-hidden />
                    Terpenuhi
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-[#d03b3b]">
                    <TriangleAlert className="size-3.5" aria-hidden />
                    Di bawah target
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}
