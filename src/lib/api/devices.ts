// Fetcher API perangkat — memanggil endpoint backend (cache Redis/TTL di
// sisi server, lihat arsitektur PRD).

import { getJson } from "@/lib/api/http";
import type {
  PonPortHealth,
  PortBandwidth,
  TemperatureReading,
  UsagePoint,
} from "@/lib/mock-metrics";
import type { NetworkDevice } from "@/types/device";

// Kontrak respons GET /api/devices.
export interface DevicesResponse {
  devices: NetworkDevice[];
  total?: number;
  updatedAt: string;
}

export function fetchDevices(): Promise<DevicesResponse> {
  return getJson<DevicesResponse>("/api/devices");
}

// Kontrak respons GET /api/devices/[id]/metrics.
export interface DeviceMetricsResponse {
  usage: UsagePoint[];
  temperature: TemperatureReading | null;
  ports: PortBandwidth[];
  updatedAt: string;
}

export interface OltOpticsResponse {
  ports: PonPortHealth[];
  updatedAt: string;
}

// Kontrak respons GET /api/devices/[id]/live.
export interface DeviceLiveResponse {
  device: NetworkDevice;
  metrics: DeviceMetricsResponse;
  optics: OltOpticsResponse | null;
  updatedAt: string;
}

export function fetchDeviceMetrics(
  deviceId: string,
): Promise<DeviceMetricsResponse> {
  return getJson<DeviceMetricsResponse>(`/api/devices/${deviceId}/metrics`);
}

export function fetchDeviceLive(deviceId: string): Promise<DeviceLiveResponse> {
  return getJson<DeviceLiveResponse>(`/api/devices/${deviceId}/live`);
}
