// Contract API Portal v1 (source of truth bentuk request/response).
//
// Fase 1 mengimplementasikan: overview, assets, assets/:assetId, incidents,
// incidents/:alertId/acknowledge (stub 501), integrations/librenms/alerts.
// Endpoint topologi, CRM, dan customer didefinisikan di sini lebih dulu dan
// diimplementasikan pada fasenya (F5 topologi, F6 CRM/customer).

import type { Asset, AssetStatus, NetworkRole } from "@/types/asset";
import type {
  AlertSeverity,
  AlertState,
} from "@/server/librenms/alert";

// --- GET /api/v1/overview ---------------------------------------------------
export interface OverviewResponse {
  totals: {
    total: number;
    online: number;
    warning: number;
    offline: number;
  };
  updatedAt: string;
}

// --- GET /api/v1/assets -----------------------------------------------------
// Query: ?site=&vendor=&role=&status=&q=
export interface AssetsQuery {
  site?: string;
  vendor?: string;
  role?: NetworkRole;
  status?: AssetStatus;
  q?: string;
}
export interface AssetsResponse {
  assets: Asset[];
  total: number;
  updatedAt: string;
}

// --- GET /api/v1/assets/:assetId -------------------------------------------
export interface AssetDetailResponse {
  asset: Asset;
  updatedAt: string;
}

// --- GET /api/v1/incidents --------------------------------------------------
// CATATAN: sebelum tabel incident tersedia (Fase 2), daftar ini dipetakan
// sementara dari log notifikasi sehingga acknowledgement belum tersedia.
export type IncidentState = "open" | "acknowledged" | "resolved";
export interface IncidentView {
  id: string;
  librenmsAlertId: string;
  assetId: string | null;
  deviceName: string;
  severity: AlertSeverity;
  state: IncidentState;
  message: string;
  triggeredAt: string;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolutionNote: string | null;
}
export interface IncidentsResponse {
  incidents: IncidentView[];
  total: number;
}

// --- POST /api/v1/incidents/:alertId/acknowledge ----------------------------
export interface AcknowledgeRequest {
  note?: string;
}
export interface AcknowledgeResponse {
  incident: IncidentView;
}

// --- POST /api/v1/integrations/librenms/alerts ------------------------------
// Webhook ingress dari LibreNMS (lihat parseLibrenmsAlert untuk payload).
// Header: x-webhook-token = LIBRENMS_WEBHOOK_SECRET (wajib di produksi).
export interface LibrenmsAlertIngestResponse {
  ok: boolean;
  librenmsAlertId: string;
  state: AlertState;
  sent: number;
  failed: number;
  /** ID incident (tabel incidents); "" bila recovery tanpa incident aktif. */
  incidentId: string;
}

// --- GET /api/v1/integrations/librenms/status -------------------------------
// Diagnostik koneksi integrasi (peran admin). Dipakai untuk memastikan mode
// terhubung benar-benar aktif dan melihat jumlah perangkat yang terpetakan.
export interface LibrenmsStatusResponse {
  configured: boolean;
  reachable: boolean;
  lastError: string | null;
  deviceCount: number;
  alertCount: number;
  assetCount: number;
  mappedAssetCount: number;
  snapshotSource: "librenms" | "fixture";
  checkedAt: string;
}

// --- Customer (implementasi Fase 6) ----------------------------------------
// GET /api/v1/customer/services/:serviceId/status
export interface CustomerServiceStatusResponse {
  serviceId: string;
  status: "up" | "degraded" | "down" | "maintenance";
  activeIncident: {
    startedAt: string;
    message: string;
  } | null;
  history: {
    occurredAt: string;
    durationMinutes: number;
    summary: string;
  }[];
  supportContact: string;
}

// --- CRM eksternal (implementasi Fase 6) ------------------------------------
// POST /api/v1/integrations/crm/service-mappings
export interface CrmServiceMappingRequest {
  externalCustomerId: string;
  externalServiceId: string;
  assetId?: string;
  librenmsGroup?: string;
}
export interface CrmServiceMappingResponse {
  mappingId: string;
  syncStatus: "active" | "pending" | "error";
}

// --- Topologi (implementasi Fase 5) -----------------------------------------
export type TopologyStatus = "draft" | "published";
export interface TopologySummary {
  topologyId: string;
  name: string;
  status: TopologyStatus;
  version: number;
  updatedAt: string;
}
export interface TopologyNode {
  nodeId: string;
  assetId: string;
  x: number;
  y: number;
  label: string | null;
}
export interface TopologyLink {
  linkId: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourcePort: string | null;
  targetPort: string | null;
  mediaType: string | null;
  capacityMbps: number | null;
  direction: "uni" | "bi";
  status: "up" | "down" | "unknown";
  note: string | null;
}
export interface TopologyDetailResponse {
  topology: TopologySummary;
  nodes: TopologyNode[];
  links: TopologyLink[];
}
export interface TopologyDiscoverySuggestion {
  suggestionId: string;
  kind: "node" | "link";
  source: "device-relation" | "lldp" | "cdp" | "fdb";
  confidence: "high" | "medium" | "low";
  discoveredAt: string;
  payload: Record<string, unknown>;
  state: "pending" | "accepted" | "rejected";
}
