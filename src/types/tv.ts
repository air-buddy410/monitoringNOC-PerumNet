export type TvTrafficState = "ok" | "belum-ada-data" | "hilang";

export interface TvTrafficInterface {
  id: string;
  ifName: string;
  label: string;
  role: "uplink" | "site" | "other";
  siteId: string | null;
  rxBps: number;
  txBps: number;
  capacityBps: number | null;
  utilizationPercent: number | null;
  sampledAt: string | null;
  state: TvTrafficState;
  missingSince: string | null;
}

export interface TvSnapshot {
  generatedAt: string;
  traffic: {
    generatedAt: string;
    sampledAt: string | null;
    ageSeconds: number | null;
    stale: boolean;
    totals: {
      uplinkRxBps: number;
      uplinkTxBps: number;
    };
    interfaces: TvTrafficInterface[];
  };
  devices: {
    total: number;
    online: number;
    warning: number;
    offline: number;
    markers: Array<{
      id: string;
      label: string;
      lat: number;
      lng: number;
      status: string;
    }>;
  };
  outages: {
    clusters: Array<{
      level: string;
      id: string;
      name: string;
      padam: number;
      total: number;
    }>;
    padamTotal: number;
    padamTersebar: number;
    aktifTotal: number;
  };
  incidents: Array<{
    id: string;
    deviceName: string;
    message: string;
    severity: string;
    state: string;
    triggeredAt: string;
  }>;
  pppoe: {
    current: number | null;
    lastRunStatus: string | null;
    trend: Array<{ t: string; count: number }>;
  };
}

export interface TvTokenSummary {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  useCount: number;
  revokedAt: string | null;
}

export interface TvTokensResponse {
  tokens: TvTokenSummary[];
}

export interface TvTokenIssued {
  id: string;
  name: string;
  token: string;
  url: string;
  expiresAt: string;
  peringatan: string;
}
