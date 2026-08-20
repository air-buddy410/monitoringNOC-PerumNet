"use client";

import useSWR from "swr";
import { getJson } from "@/lib/api/http";

export type AuthProvider = "LOCAL" | "MAILSERVER";

export interface AuthModeResponse {
  provider: AuthProvider;
  passwordChangeAvailable: boolean;
  passwordRequiredOnCreate: boolean;
  emailChangeAvailable: boolean;
}

/**
 * Sumber kebenaran untuk kontrol UI yang bergantung pada penyedia identitas.
 * Endpoint ini publik dan sengaja tidak dipoll; mode berubah hanya saat
 * konfigurasi server berubah.
 */
export function useAuthMode() {
  const { data, error, isLoading } = useSWR<AuthModeResponse>(
    "/api/auth-mode",
    getJson<AuthModeResponse>,
    { revalidateOnFocus: false },
  );

  return { data, error, isLoading };
}
