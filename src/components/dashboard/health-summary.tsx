"use client";

import useSWR from "swr";
import ApiErrorNotice from "@/components/api-error-notice";
import { getJson } from "@/lib/api/http";
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/status";
import type { OverviewResponse } from "@/server/api-v1/contracts";
import { Activity, CheckCircle2, Server, TriangleAlert } from "lucide-react";

/** Big numbers dasbor dari kontrak v1 (/api/v1/overview). */
export default function HealthSummary() {
  const { data, error } = useSWR<OverviewResponse>("/api/v1/overview", getJson, {
    refreshInterval: 10_000,
    refreshWhenHidden: true,
    revalidateOnFocus: false,
  });
  const hasData = (data?.totals.total ?? 0) > 0;

  const cards: {
    label: string;
    value: number;
    color?: string;
    pulse?: boolean;
    icon: typeof Server;
  }[] = [
    { label: "Total perangkat", value: data?.totals.total ?? 0, icon: Server },
    {
      label: STATUS_LABELS.online,
      value: data?.totals.online ?? 0,
      color: STATUS_COLORS.online,
      icon: CheckCircle2,
    },
    {
      label: STATUS_LABELS.warning,
      value: data?.totals.warning ?? 0,
      color: STATUS_COLORS.warning,
      icon: TriangleAlert,
    },
    {
      label: STATUS_LABELS.offline,
      value: data?.totals.offline ?? 0,
      color: STATUS_COLORS.offline,
      pulse: (data?.totals.offline ?? 0) > 0,
      icon: Activity,
    },
  ];

  return (
    <>
      {error && (
        <ApiErrorNotice
          error={error}
          fallback="Ringkasan kesehatan jaringan tidak dapat dimuat."
          className="mb-3 rounded-lg"
        />
      )}
      <div className="noc-health-grid">
        {cards.map((card) => (
          <div key={card.label} className="noc-health-card">
            <span
              className={`noc-health-icon ${card.pulse ? "is-pulsing" : ""}`}
              style={card.color ? { color: card.color } : undefined}
            >
              <card.icon />
            </span>
            <div>
              <p>{card.label}</p>
              <strong style={card.color ? { color: card.color } : undefined}>
                {hasData ? card.value : "–"}
              </strong>
              <small>
                {card.label === "Total perangkat" ? "Seluruh lokasi" : "Status terkini"}
              </small>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
