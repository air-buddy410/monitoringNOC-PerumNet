"use client";

import useSWR from "swr";
import { fetchDeviceLive } from "@/lib/api/devices";
import { DEVICES_REFRESH_INTERVAL_MS } from "@/hooks/use-devices";

/**
 * Satu sumber polling untuk halaman detail perangkat. Semua panel real-time
 * membaca hasil yang sama dari SWR, sehingga tidak membuat request metrics dan
 * optics terpisah pada siklus yang sama.
 */
export function useDeviceLive(deviceId: string) {
  const { data, error, isLoading } = useSWR(
    ["device-live", deviceId],
    ([, id]) => fetchDeviceLive(id),
    {
      refreshInterval: DEVICES_REFRESH_INTERVAL_MS,
      refreshWhenHidden: true,
      revalidateOnFocus: false,
    },
  );

  return { data, error, isLoading };
}
