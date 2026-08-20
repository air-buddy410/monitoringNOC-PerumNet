"use client";

import useSWR from "swr";
import { getJson } from "@/lib/api/http";
import type { Role } from "@/server/rbac";

export interface SessionData {
  user: {
    id: string;
    name: string;
    email: string;
    role: Role;
  };
  session: {
    token: string;
    expiresAt: string;
  };
}

/** Sesi Better Auth yang sedang aktif (null bila belum login). */
export function useSession(enabled = true) {
  const { data, isLoading, mutate } = useSWR(
    enabled ? "/api/auth/get-session" : null,
    getJson<SessionData | null>,
    { revalidateOnFocus: false },
  );
  return { session: data ?? null, isLoading, mutate };
}
