"use client";

import useSWR from "swr";
import { getJson } from "@/lib/api/http";
import type { BackupFreshnessResponse } from "@/types/operations";

export function useBackupFreshness(enabled = true) {
  const { data, error, isLoading } = useSWR<BackupFreshnessResponse>(
    enabled ? "/api/backup-freshness" : null,
    getJson<BackupFreshnessResponse>,
    { revalidateOnFocus: false },
  );

  return { data, error, isLoading };
}
