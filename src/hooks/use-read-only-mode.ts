"use client";

import useSWR from "swr";
import { getJson } from "@/lib/api/http";
import type { ReadOnlyModeResponse } from "@/types/operations";

export function useReadOnlyMode(enabled = true) {
  const { data, error, isLoading } = useSWR<ReadOnlyModeResponse>(
    enabled ? "/api/read-only-mode" : null,
    getJson<ReadOnlyModeResponse>,
    { revalidateOnFocus: false },
  );

  return { data, error, isLoading };
}
