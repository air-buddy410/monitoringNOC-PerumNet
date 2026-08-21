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

export interface PppoeSessionsResponse {
  lastRun: PppoeLastRun | null;
  sessions: PppoeSession[];
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
