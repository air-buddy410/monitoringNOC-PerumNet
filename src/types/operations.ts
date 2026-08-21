export type OperationRole = "admin" | "noc" | "engineer" | "manajemen";

export interface ReadOnlyModeResponse {
  readOnly: boolean;
  outwardActions: "BLOCKED" | "ALLOWED";
  configured: {
    "crm-webhook": boolean;
    telegram: boolean;
    whatsapp: boolean;
  };
  reason: string;
}

export type BackupHealth = "ok" | "basi" | "mencurigakan" | "tidak-ada";

export interface BackupFreshnessApp {
  key: string;
  label: string;
  health: BackupHealth;
  latestAt: string | null;
  ageHours: number | null;
  bytes: number | null;
  previousBytes: number | null;
  count: number | null;
  reason: string;
}

export interface BackupFreshnessResponse {
  needsAttention: boolean;
  checkedAt: string;
  apps: BackupFreshnessApp[];
}

export interface NetworkSite {
  id: string;
  code: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
}

export interface SitesResponse {
  sites: NetworkSite[];
}

export interface Subnet {
  id: string;
  cidr: string;
  name: string;
  gateway: string | null;
  vlanId: number | null;
  siteId: string | null;
  purpose: string | null;
  usedCount: number;
}

export interface SubnetsResponse {
  subnets: Subnet[];
}

export type IpAddressStatus = "dipakai" | "dicadangkan" | "bebas";

export interface IpAddress {
  id: string;
  subnetId: string;
  address: string;
  assetId: string | null;
  label: string | null;
  status: IpAddressStatus;
}

export interface AddressesResponse {
  addresses: IpAddress[];
}

export interface Odp {
  id: string;
  code: string;
  name: string;
  siteId: string | null;
  oltId: string | null;
  latitude: number | null;
  longitude: number | null;
  capacity: number;
  usedPorts: number;
  brokenPorts: number;
}

export interface OdpsResponse {
  odps: Odp[];
}

export type OdpPortStatus = "kosong" | "terpakai" | "rusak" | "dicadangkan";

export interface OdpPort {
  id: string;
  odpId: string;
  portNumber: number;
  status: OdpPortStatus;
  externalServiceId: string | null;
  notes: string | null;
}

export interface OdpPortsResponse {
  ports: OdpPort[];
}

export type OtbStatus = "aktif" | "nonaktif";

export interface OtbSummary {
  id: string;
  code: string;
  name: string;
  siteId: string | null;
  siteName: string | null;
  defaultConnectorType: "SC" | "LC";
  defaultPolish: "UPC" | "APC";
  latitude: number | null;
  longitude: number | null;
  status: OtbStatus;
  trayCount: number;
  portCount: number;
  usedPorts: number;
  brokenPorts: number;
}

export interface OtbResponse {
  otb: OtbSummary[];
}

export type OtbTrayStatus = "terhubung" | "sebagian" | "kosong" | "nonaktif";

export interface OtbTray {
  id: string;
  trayNumber: number;
  connectorType: "SC" | "LC";
  polish: "UPC" | "APC";
  label: string | null;
  portCount: number;
  usedPorts: number;
  brokenPorts: number;
  status: OtbTrayStatus;
}

export interface OtbDetail extends Omit<OtbSummary, "trayCount" | "portCount" | "usedPorts" | "brokenPorts"> {
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  trays: OtbTray[];
}

export type OtbPortStatus = "kosong" | "terpakai" | "dicadangkan" | "rusak" | "nonaktif";

export interface OtbPort {
  id: string;
  portNumberInTray: number;
  globalPortNumber: number;
  status: OtbPortStatus;
  externalServiceId: string | null;
  notes: string | null;
  updatedAt: string;
}

export interface OtbPortsResponse {
  ports: OtbPort[];
}

export type FiberCableCategory = "backbone" | "feeder" | "distribution" | "dropcore" | "interconnect" | "lain";
export type FiberType = "G.652D" | "G.657A1" | "G.657A2" | "lain";
export type FiberCableStatus = "aktif" | "nonaktif";
export type FiberCorePurpose = "feeder" | "distribution";
export type FiberCoreStatus = "baik" | "rusak" | "nonaktif";

export interface FiberCableSummary {
  id: string;
  code: string;
  name: string | null;
  category: FiberCableCategory;
  fiberType: FiberType;
  coreCount: number;
  lengthM: number | null;
  status: FiberCableStatus;
  coreTerpasang: number;
  coreFeeder: number;
  coreDistribution: number;
  coreRusak: number;
}

export interface FiberCablesResponse {
  cables: FiberCableSummary[];
}

export interface FiberCore {
  id: string;
  coreNumber: number;
  tubeNumber: number | null;
  color: string | null;
  purpose: FiberCorePurpose;
  label: string | null;
  status: FiberCoreStatus;
  notes: string | null;
  ujungTerpakai: Array<"A" | "B">;
}

export interface FiberCableDetail extends Omit<FiberCableSummary, "coreTerpasang" | "coreFeeder" | "coreDistribution" | "coreRusak"> {
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  cores: FiberCore[];
}

export interface FiberTerminationTarget {
  jenis: "otbPort" | "odpPort";
  label: string;
  otbCode?: string | null;
  trayNumber?: number | null;
  portNumberInTray?: number | null;
  globalPortNumber?: number | null;
  odpCode?: string | null;
  odpRole?: string | null;
  portNumber?: number | null;
}

export interface FiberTerminationHistory {
  id: string;
  coreEnd: "A" | "B";
  otbPortId: string | null;
  odpPortId: string | null;
  reason: string;
  deactivatedAt: string | null;
  deactivatedReason: string | null;
  createdAt: string;
  aktif: boolean;
  sasaran: FiberTerminationTarget;
}

export interface FiberTerminationHistoryResponse {
  terminations: FiberTerminationHistory[];
}

export type ClosureType = "inline" | "dome" | "lain";
export type ClosureStatus = "aktif" | "nonaktif";

export interface ClosureSummary {
  id: string;
  code: string;
  name: string | null;
  siteId: string | null;
  siteName: string | null;
  latitude: number | null;
  longitude: number | null;
  type: ClosureType;
  status: ClosureStatus;
  silanganAktif: number;
  silanganTotal: number;
}

export interface ClosuresResponse {
  closures: ClosureSummary[];
}

export interface ClosureSplice {
  id: string;
  inputCoreId: string;
  inputCoreEnd: "A" | "B";
  inputCoreNumber: number;
  inputCoreColor: string | null;
  inputCablePurpose: FiberCorePurpose;
  inputCableCode: string;
  outputCoreId: string;
  outputCoreEnd: "A" | "B";
  outputCoreNumber: number;
  outputCoreColor: string | null;
  outputCablePurpose: FiberCorePurpose;
  outputCableCode: string;
  silang: boolean;
  estimatedLossDb: number | null;
  reason: string;
  deactivatedAt: string | null;
  deactivatedReason: string | null;
  createdAt: string;
}

export interface ClosureDetail extends ClosureSummary {
  notes: string | null;
  createdAt: string;
  splices: ClosureSplice[];
}

export interface ClosureDetailResponse extends ClosureDetail {
  splices: ClosureSplice[];
}

export interface ClosureSpliceRow {
  inputCoreId: string;
  inputCoreEnd: "A" | "B";
  outputCoreId: string;
  outputCoreEnd: "A" | "B";
  estimatedLossDb?: number | null;
}

export interface ClosurePreviewVerdict {
  urutan: number;
  ok: boolean;
  error?: string;
  silangNomor?: { dari: number; ke: number };
}

export interface ClosurePreviewResponse {
  verdicts: ClosurePreviewVerdict[];
  ringkas: { total: number; gagal: number; lolos: number };
}

export interface ClosureCommitResponse {
  dipasang: number;
  ids: string[];
  verdicts: ClosurePreviewVerdict[];
}

export interface TraceStep {
  urutan: number;
  jenis: "PORT_OTB" | "PORT_ODP" | "CORE" | "SILANGAN" | "SPLITTER";
  label: string;
  detail: Record<string, unknown>;
}

export type TracePathStatus = "LENGKAP" | "UJUNG_JALUR" | "JALUR_PUTUS" | "BERPUTAR" | "AMBIGU" | "TERPOTONG";

export interface TracePath {
  langkah: TraceStep[];
  status: TracePathStatus;
  diagnosis?: string;
  ringkas: {
    hop: number;
    panjangM: number | null;
    panjangLengkap: boolean;
    segmenUnik: number;
    segmenBerulang: number;
    estimasiLossDb: number;
    sambunganPakaiModel: number;
  };
}

export interface TraceResponse {
  mulai: { jenis: string; id: string; label: string };
  jalur: TracePath[];
  ringkas: { total: number; lengkap: number; bermasalah: number; terpotong?: boolean };
}

export type PppoeRunStatus = "SUCCESS" | "FAILED" | "SKIPPED" | "RUNNING";

export interface PppoeLastRun {
  status: PppoeRunStatus;
  startedAt: string;
  finishedAt: string | null;
  sessionCount: number | null;
  error: string | null;
}

export interface PppoeSession {
  username: string;
  address: string | null;
  callerId: string | null;
  uptimeSec: number | null;
  routerName: string | null;
  seenAt: string;
}

export type PppoeSortColumn = "username" | "address" | "uptime" | "seenAt" | "router";
export type PppoePageSize = 20 | 50 | 100;

export interface PppoeSessionsResponse {
  lastRun: PppoeLastRun | null;
  sessions: PppoeSession[];
  total: number;
  page: number;
  pageSize: PppoePageSize;
  halamanTerakhir: number;
  terpotong: boolean;
  routers: string[];
}

export type ProbeStatus = "UP" | "DOWN" | null;

export interface ProbeTarget {
  id: string;
  name: string;
  address: string;
  port: number;
  assetId: string | null;
  severity: "warning" | "critical";
  isActive: boolean;
  status: ProbeStatus;
  latencyMs: number | null;
  consecutiveFails: number;
  failThreshold: number;
  checkedAt: string | null;
  hasOpenAlarm: boolean;
}

export interface ProbeTargetsResponse {
  targets: ProbeTarget[];
}

export interface SchedulerTask {
  code: string;
  name: string;
  description: string | null;
  isEnabled: boolean;
  intervalSec: number;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastDurationMs: number | null;
  runCount: number;
  failCount: number;
  overdueSec: number | null;
  stalled: boolean;
}

export interface SchedulerResponse {
  workerLikelyDown: boolean;
  tasks: SchedulerTask[];
}

export type AlarmSeverity = "warning" | "critical" | string;
export type AlarmSource = "PROBE" | "LIBRENMS" | "MANUAL" | string;

export interface NetworkAlarm {
  id: string;
  alarmNumber: string;
  severity: AlarmSeverity;
  source: AlarmSource;
  assetId: string | null;
  message: string;
  count: number;
  occurredAt: string;
  lastSeenAt: string;
  acknowledgedAt: string | null;
  clearedAt: string | null;
}

export interface AlarmsResponse {
  alarms: NetworkAlarm[];
}

export type IncidentUpdateKind =
  | "catatan"
  | "status"
  | "eskalasi"
  | "penyebab"
  | "penutupan";

export interface IncidentUpdate {
  id: string;
  incidentId: string;
  authorUserId: string | null;
  authorLabel: string | null;
  kind: IncidentUpdateKind;
  body: string;
  createdAt: string;
}

export interface IncidentUpdatesResponse {
  updates: IncidentUpdate[];
}

export interface OltConsoleTarget {
  id: string;
  name: string;
  managementIp: string;
  vendor: string | null;
  model: string | null;
  siteId: string | null;
  siteName: string | null;
  telnetPort: number | null;
  assetId: string | null;
  odpCount: number;
  konsolSiap: boolean;
  alasan: string | null;
}

export interface OltConsoleTargetsResponse {
  olts: OltConsoleTarget[];
  konsolTersedia: boolean;
}

export interface ConsoleCommandResponse {
  olt: { id: string; name: string };
  command: string;
  output: string;
}
