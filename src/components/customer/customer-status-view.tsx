"use client";

// Halaman status layanan untuk pelanggan (Fase 6) — tampilan publik tanpa
// NocShell. Hanya status/riwayat ringkas; tidak ada data internal.

import Image from "next/image";
import useSWR from "swr";
import { CheckCircle2, Clock, Loader2, ShieldAlert, Wrench } from "lucide-react";
import type { CustomerServiceStatusResponse } from "@/server/api-v1/contracts";

const fetcher = (url: string) =>
  fetch(url).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  });

const statusMeta: Record<
  CustomerServiceStatusResponse["status"],
  { label: string; color: string; bg: string; icon: typeof CheckCircle2; note: string }
> = {
  up: {
    label: "Layanan Normal",
    color: "text-emerald-600",
    bg: "bg-emerald-50 border-emerald-200",
    icon: CheckCircle2,
    note: "Tidak ada gangguan terdeteksi saat ini.",
  },
  degraded: {
    label: "Gangguan Diketahui",
    color: "text-amber-600",
    bg: "bg-amber-50 border-amber-200",
    icon: ShieldAlert,
    note: "Tim kami sedang menangani gangguan yang terdeteksi.",
  },
  down: {
    label: "Layanan Terputus",
    color: "text-red-600",
    bg: "bg-red-50 border-red-200",
    icon: Wrench,
    note: "Layanan Anda sedang terganggu — tim kami bekerja memulihkannya.",
  },
  maintenance: {
    label: "Pemeliharaan",
    color: "text-sky-600",
    bg: "bg-sky-50 border-sky-200",
    icon: Clock,
    note: "Sedang dilakukan pemeliharaan terjadwal.",
  },
};

export default function CustomerStatusView({
  customerId,
  serviceId,
  token,
}: {
  customerId: string;
  serviceId: string;
  token: string;
}) {
  const apiUrl =
    customerId && serviceId && token
      ? `/api/v1/customer/services/${encodeURIComponent(serviceId)}/status?customerId=${encodeURIComponent(customerId)}&token=${encodeURIComponent(token)}`
      : null;

  const { data, error, isLoading } = useSWR<CustomerServiceStatusResponse>(
    apiUrl,
    fetcher,
    { refreshInterval: 30_000, revalidateOnFocus: true },
  );

  return (
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 pb-4">
        <Image
          src="/brand/perumnet-mark.png"
          alt=""
          width={26}
          height={30}
          priority
        />
        <div>
          <p className="text-sm font-bold text-slate-800">PerumNet</p>
          <p className="text-xs text-slate-400">Status Layanan Pelanggan</p>
        </div>
      </div>

      <div className="py-6">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
          Layanan #{serviceId}
        </p>

        {isLoading && (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="animate-spin" size={16} /> Memeriksa status…
          </p>
        )}

        {!isLoading && error && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
            Status tidak dapat ditampilkan. Periksa kembali tautan status
            layanan Anda dari pihak PerumNet.
          </div>
        )}

        {!isLoading && data && (
          <>
            {(() => {
              const meta = statusMeta[data.status];
              const Icon = meta.icon;
              return (
                <div className={`rounded-xl border p-4 ${meta.bg}`}>
                  <div className="flex items-center gap-2">
                    <Icon className={meta.color} size={22} aria-hidden="true" />
                    <span className={`text-lg font-bold ${meta.color}`}>
                      {meta.label}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm text-slate-600">{meta.note}</p>
                </div>
              );
            })()}

            {data.activeIncident && (
              <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50/60 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
                  Gangguan berlangsung
                </p>
                <p className="mt-1 text-sm text-slate-700">
                  {data.activeIncident.message}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Sejak{" "}
                  {new Date(data.activeIncident.startedAt).toLocaleString("id-ID", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </div>
            )}

            {data.history.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Riwayat 30 hari terakhir
                </p>
                <ul className="divide-y divide-slate-50">
                  {data.history.map((item, index) => (
                    <li key={`${item.occurredAt}-${index}`} className="flex gap-2 py-2 text-sm">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                      <div className="min-w-0">
                        <p className="truncate text-slate-700">{item.summary}</p>
                        <p className="text-xs text-slate-400">
                          {new Date(item.occurredAt).toLocaleDateString("id-ID", {
                            day: "2-digit",
                            month: "short",
                          })}{" "}
                          · ±{item.durationMinutes} menit
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      <div className="rounded-lg bg-slate-50 p-3 text-center text-xs text-slate-500">
        Butuh bantuan? Hubungi <strong>{data?.supportContact ?? "PerumNet"}</strong>
      </div>
    </div>
  );
}
