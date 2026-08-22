"use client";

import useSWR from "swr";
import { getJson } from "@/lib/api/http";
import type { FiberGeoResponse } from "@/types/fiber-geo";

export function useFiberGeo() {
  return useSWR<FiberGeoResponse>(
    "/api/v1/ftth/geo",
    getJson<FiberGeoResponse>,
    { revalidateOnFocus: false },
  );
}
