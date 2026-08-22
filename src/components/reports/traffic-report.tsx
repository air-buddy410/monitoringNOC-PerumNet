"use client";

import useSWR from "swr";
import ApiErrorNotice from "@/components/api-error-notice";
import ReportSourceBanner, { type ReportSource } from "@/components/reports/report-source-banner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getJson } from "@/lib/api/http";
import { formatVolume } from "@/lib/mock-reports";
import type { DeviceGroup } from "@/types/device";

interface TrafficRow {
  deviceId: string;
  deviceName: string;
  group: DeviceGroup;
  area: string;
  downloadGb: number;
  uploadGb: number;
  avgMbps: number;
  peakMbps: number;
}

interface TrafficResponse {
  period: string;
  source: ReportSource;
  rows: TrafficRow[];
  summary: { devices: number; totalDownloadGb: number; totalUploadGb: number };
}

export default function TrafficReport({ period }: { period: string }) {
  const { data, error } = useSWR(
    `/api/reports/traffic?period=${period}`,
    getJson<TrafficResponse>,
    { revalidateOnFocus: false },
  );
  const rows = data?.rows ?? [];

  if (error) {
    return (
      <ApiErrorNotice
        error={error}
        fallback="Laporan trafik tidak dapat dimuat."
        className="rounded-lg bg-card py-8 text-center"
      />
    );
  }

  const source = data?.source;
  const hasRows = Boolean(data && data.rows.length > 0);

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <p className="text-sm font-medium">Laporan Penggunaan Trafik</p>
        <p className="text-xs text-muted-foreground">
          {data ? (
            <>
              {source === "belum-ada-data" ? "Belum ada rekap" : <>Total download{" "}
                <span className="font-medium tabular-nums text-foreground">
                  {formatVolume(data.summary.totalDownloadGb)}
                </span>{" "}
                · upload{" "}
                <span className="font-medium tabular-nums text-foreground">
                  {formatVolume(data.summary.totalUploadGb)}
                </span></>}
            </>
          ) : (
            "Memuat laporan…"
          )}
        </p>
      </div>
      {source && <div className="px-4 pt-4"><ReportSourceBanner source={source} /></div>}
      {!data && <div className="px-4 pb-4"><p className="text-center text-sm text-muted-foreground">Memuat laporan…</p></div>}
      {data && !hasRows && <div className="px-4 pb-4"><p className="text-center text-sm text-muted-foreground">Tidak ada baris untuk ditampilkan pada periode ini.</p></div>}
      {hasRows && <div className="divide-y md:hidden">
        {rows.map((row) => (
          <article key={row.deviceId} className="p-4">
            <h3 className="text-sm font-semibold">{row.deviceName}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {row.group} · {row.area}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <span>Download<br /><b className="text-foreground">{formatVolume(row.downloadGb)}</b></span>
              <span>Upload<br /><b className="text-foreground">{formatVolume(row.uploadGb)}</b></span>
              <span>Rata-rata<br /><b className="text-foreground">{row.avgMbps} Mbps</b></span>
              <span>Puncak<br /><b className="text-foreground">{row.peakMbps} Mbps</b></span>
            </div>
          </article>
        ))}
      </div>}
      {hasRows && <div className="hidden md:block">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Perangkat</TableHead>
            <TableHead>Jenis</TableHead>
            <TableHead>Area</TableHead>
            <TableHead className="text-right">Download</TableHead>
            <TableHead className="text-right">Upload</TableHead>
            <TableHead className="text-right">Rata-rata</TableHead>
            <TableHead className="text-right">Puncak</TableHead>
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
              <TableCell className="text-right text-xs font-semibold tabular-nums">
                {formatVolume(row.downloadGb)}
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                {formatVolume(row.uploadGb)}
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                {row.avgMbps} Mbps
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                {row.peakMbps} Mbps
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>}
    </div>
  );
}
