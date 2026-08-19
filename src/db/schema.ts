// Skema database aplikasi — PostgreSQL (Drizzle), baseline Fase 2.
//
// Prinsip (sesuai docs/PROMPT_CLAUDE_IMPLEMENTASI_LIBRENMS.md):
// - LibreNMS adalah source of truth telemetry; portal TIDAK menyimpan raw
//   telemetry. Tabel telemetry era SQLite (device_metrics, port_metrics,
//   pon_port_samples, onu_status_samples, metric_history) DIPENSIUNKAN dan
//   datanya (mock) tidak dimigrasikan.
// - `sla_monthly` / `traffic_monthly` dipertahankan sebagai CACHE laporan
//   turunan (diisi ulang dari LibreNMS pada Fase 3; data mock lama tidak
//   dibawa).
// - `notification_logs` adalah tabel LEGACY-AKTIF: masih memberi makan UI
//   riwayat & pemetaan incident interim; digantikan `incidents` +
//   `notification_deliveries` mulai Fase 4 dan dihapus pada Fase 7.
// - Migrasi data dari SQLite + rollback: lihat docs/DB_MIGRATION.md.

import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "@/db/auth-schema";

// ---------------------------------------------------------------------------
// Aset (pengganti device_metadata) — metadata aplikasi di luar LibreNMS.
// ---------------------------------------------------------------------------
export const assets = pgTable("assets", {
  assetId: text("asset_id").primaryKey(),
  /** ID device pada LibreNMS; null bila belum dipetakan. */
  librenmsDeviceId: integer("librenms_device_id").unique(),
  hostname: text("hostname").notNull(),
  displayName: text("display_name").notNull(),
  managementIp: text("management_ip").notNull(),
  /** Vendor/merek dari metadata LibreNMS (`manufacturer`/`os`). */
  vendor: text("vendor").notNull(),
  os: text("os"),
  /** Hardware/model dari LibreNMS (`hardware`). */
  model: text("model"),
  serialNumber: text("serial_number"),
  site: text("site").notNull(),
  location: text("location"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  networkRole: text("network_role", {
    enum: ["core", "distribution", "access", "olt", "server", "infrastructure"],
  }).notNull(),
  /** Referensi CRM eksternal opsional (mapping saja, bukan data CRM). */
  crmCustomerId: text("crm_customer_id"),
  crmServiceId: text("crm_service_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Mapping layanan CRM eksternal (portal hanya menyimpan mapping minimal).
// ---------------------------------------------------------------------------
export const crmServiceMappings = pgTable(
  "crm_service_mappings",
  {
    id: text("id").primaryKey(),
    externalCustomerId: text("external_customer_id").notNull(),
    externalServiceId: text("external_service_id").notNull(),
    assetId: text("asset_id").references(() => assets.assetId, {
      onDelete: "set null",
    }),
    /** Alternatif pemetaan ke group LibreNMS, bukan aset tunggal. */
    librenmsGroup: text("librenms_group"),
    syncStatus: text("sync_status", {
      enum: ["active", "pending", "error"],
    })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("crm_service_mappings_service_idx").on(
      table.externalCustomerId,
      table.externalServiceId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Incident (alert LibreNMS yang dinormalisasi) + acknowledgement.
// ---------------------------------------------------------------------------
export const incidents = pgTable(
  "incidents",
  {
    id: text("id").primaryKey(),
    librenmsAlertId: text("librenms_alert_id").notNull(),
    assetId: text("asset_id").references(() => assets.assetId, {
      onDelete: "set null",
    }),
    deviceName: text("device_name").notNull(),
    severity: text("severity", {
      enum: ["ok", "warning", "critical"],
    }).notNull(),
    state: text("state", {
      enum: ["open", "acknowledged", "resolved"],
    })
      .notNull()
      .default("open"),
    message: text("message").notNull(),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull(),
    recoveredAt: timestamp("recovered_at", { withTimezone: true }),
    acknowledgedBy: text("acknowledged_by").references(() => user.id, {
      onDelete: "set null",
    }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Idempotency webhook (Fase 4): satu incident belum-resolved per alert.
    uniqueIndex("incidents_active_alert_idx")
      .on(table.librenmsAlertId)
      .where(sql`${table.state} <> 'resolved'`),
  ],
);

// ---------------------------------------------------------------------------
// Audit log umum untuk aksi yang mengubah keadaan.
// ---------------------------------------------------------------------------
export const auditLogs = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  /** null = aksi sistem (webhook/worker). */
  actorUserId: text("actor_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  actorLabel: text("actor_label").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Log pengiriman notifikasi per channel (menggantikan peran audit kirim pada
// notification_logs mulai Fase 4).
// ---------------------------------------------------------------------------
export const notificationDeliveries = pgTable("notification_deliveries", {
  id: text("id").primaryKey(),
  incidentId: text("incident_id").references(() => incidents.id, {
    onDelete: "set null",
  }),
  channelId: text("channel_id").references(() => notificationChannels.id, {
    onDelete: "set null",
  }),
  channelType: text("channel_type", {
    enum: ["telegram", "whatsapp"],
  }).notNull(),
  target: text("target").notNull(),
  status: text("status", { enum: ["sent", "failed"] }).notNull(),
  /** Keterangan provider (mis. "telegram-bot-api", pesan error aman). */
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Topologi jaringan: diagram, node, link, usulan discovery, versi/publish.
// ---------------------------------------------------------------------------
export const topologies = pgTable("topologies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status", { enum: ["draft", "published"] })
    .notNull()
    .default("draft"),
  /** Versi published terakhir; 0 = belum pernah publish. */
  currentVersion: integer("current_version").notNull().default(0),
  createdBy: text("created_by").references(() => user.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const topologyNodes = pgTable(
  "topology_nodes",
  {
    id: text("id").primaryKey(),
    topologyId: text("topology_id")
      .notNull()
      .references(() => topologies.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.assetId, { onDelete: "cascade" }),
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    /** Label override; identitas utama tetap metadata aset. */
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("topology_nodes_topology_asset_idx").on(
      table.topologyId,
      table.assetId,
    ),
  ],
);

export const topologyLinks = pgTable("topology_links", {
  id: text("id").primaryKey(),
  topologyId: text("topology_id")
    .notNull()
    .references(() => topologies.id, { onDelete: "cascade" }),
  sourceNodeId: text("source_node_id")
    .notNull()
    .references(() => topologyNodes.id, { onDelete: "cascade" }),
  targetNodeId: text("target_node_id")
    .notNull()
    .references(() => topologyNodes.id, { onDelete: "cascade" }),
  sourcePort: text("source_port"),
  targetPort: text("target_port"),
  /** Jenis media/link (fiber, wireless, dsb) — tanpa kredensial apa pun. */
  mediaType: text("media_type"),
  capacityMbps: integer("capacity_mbps"),
  direction: text("direction", { enum: ["uni", "bi"] })
    .notNull()
    .default("bi"),
  status: text("status", { enum: ["up", "down", "unknown"] })
    .notNull()
    .default("unknown"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const topologyDiscoverySuggestions = pgTable(
  "topology_discovery_suggestions",
  {
    id: text("id").primaryKey(),
    topologyId: text("topology_id")
      .notNull()
      .references(() => topologies.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["node", "link"] }).notNull(),
    /** Sumber data discovery pada LibreNMS. */
    source: text("source", {
      enum: ["device-relation", "lldp", "cdp", "fdb"],
    }).notNull(),
    confidence: text("confidence", {
      enum: ["high", "medium", "low"],
    }).notNull(),
    /** Payload usulan (node/link) apa adanya, berprovenance. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    state: text("state", { enum: ["pending", "accepted", "rejected"] })
      .notNull()
      .default("pending"),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull(),
    reviewedBy: text("reviewed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
);

export const topologyVersions = pgTable(
  "topology_versions",
  {
    id: text("id").primaryKey(),
    topologyId: text("topology_id")
      .notNull()
      .references(() => topologies.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    /** Snapshot lengkap nodes+links saat publish. */
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    publishedBy: text("published_by").references(() => user.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("topology_versions_topology_version_idx").on(
      table.topologyId,
      table.version,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Channel notifikasi (bot WhatsApp/Telegram) — dibawa dari SQLite.
// ---------------------------------------------------------------------------
export const notificationChannels = pgTable("notification_channels", {
  id: text("id").primaryKey(),
  type: text("type", { enum: ["telegram", "whatsapp"] }).notNull(),
  recipientName: text("recipient_name").notNull(),
  /** Username/ID Telegram atau nomor WhatsApp tujuan. */
  target: text("target").notNull(),
  verified: boolean("verified").notNull().default(false),
  active: boolean("active").notNull().default(false),
  /** Kode verifikasi yang harus dikirim ke bot; null setelah terverifikasi. */
  verificationCode: text("verification_code"),
  /** ID chat akun WA/Telegram yang tertaut setelah kode diverifikasi bot. */
  chatId: text("chat_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// LEGACY-AKTIF: audit alert per channel era Fase 1 (dibawa dari SQLite).
// Digantikan `incidents` + `notification_deliveries` mulai Fase 4;
// dihapus pada Fase 7 setelah UI pindah.
// ---------------------------------------------------------------------------
export const notificationLogs = pgTable("notification_logs", {
  id: text("id").primaryKey(),
  librenmsAlertId: text("librenms_alert_id").notNull(),
  deviceName: text("device_name").notNull(),
  alertType: text("alert_type", { enum: ["telegram", "whatsapp"] }).notNull(),
  messageContent: text("message_content").notNull(),
  status: text("status", { enum: ["sent", "failed"] }).notNull(),
  /** Catatan solusi/tindak lanjut yang diisi tim NOC. */
  resolutionNote: text("resolution_note"),
  triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull(),
});

// ---------------------------------------------------------------------------
// Audit riwayat ekspor laporan — dibawa dari SQLite.
// ---------------------------------------------------------------------------
export const slaReports = pgTable("sla_reports", {
  id: text("id").primaryKey(),
  reportName: text("report_name").notNull(),
  reportType: text("report_type", { enum: ["sla", "traffic"] }).notNull(),
  formatType: text("format_type", { enum: ["pdf", "excel"] }).notNull(),
  period: text("period").notNull(),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  generatedAt: timestamp("generated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// CACHE laporan bulanan turunan (regenerable). Data era mock TIDAK dibawa;
// diisi dari agregasi LibreNMS (Fase 3) atau fixture berlabel di development.
// ---------------------------------------------------------------------------
export const slaMonthly = pgTable(
  "sla_monthly",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.assetId, { onDelete: "cascade" }),
    /** Periode laporan, format "YYYY-MM". */
    period: text("period").notNull(),
    uptimePercent: doublePrecision("uptime_percent").notNull(),
    downtimeMinutes: integer("downtime_minutes").notNull(),
    incidents: integer("incidents").notNull(),
  },
  (table) => [
    uniqueIndex("sla_monthly_asset_period_idx").on(
      table.assetId,
      table.period,
    ),
  ],
);

export const trafficMonthly = pgTable(
  "traffic_monthly",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.assetId, { onDelete: "cascade" }),
    /** Periode laporan, format "YYYY-MM". */
    period: text("period").notNull(),
    downloadGb: doublePrecision("download_gb").notNull(),
    uploadGb: doublePrecision("upload_gb").notNull(),
    avgMbps: doublePrecision("avg_mbps").notNull(),
    peakMbps: doublePrecision("peak_mbps").notNull(),
  },
  (table) => [
    uniqueIndex("traffic_monthly_asset_period_idx").on(
      table.assetId,
      table.period,
    ),
  ],
);

// ── Penjadwal & probe (Fase 9, meniru pola CRM) ───────────────────────────
//
// Sampai Fase 8 portal ini TIDAK punya penjadwal sama sekali: tidak ada worker,
// cron, maupun setInterval, dan seluruh telemetry datang dari LibreNMS. Itu
// berhenti berguna ketika LibreNMS tidak punya perangkat terdaftar — portal
// jadi buta bukan karena rusak, melainkan karena sumbernya kosong.
//
// Tabel di bawah menyalin pola yang sudah terbukti jalan di CRM
// (`crm/src/lib/scheduler.ts`, `crm/src/lib/probe.ts`): pekerjaan terjadwal
// dengan sewa, dan probe TCP yang mengukur keterjangkauan sendiri.

/**
 * Pekerjaan terjadwal. `isEnabled` adalah keadaan OPERATOR — `syncTaskRegistry`
 * sengaja tidak pernah menimpanya, supaya deploy biasa tidak menyalakan kembali
 * apa yang sengaja dimatikan orang.
 */
export const scheduledTasks = pgTable(
  "scheduled_tasks",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    intervalSec: integer("interval_sec").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),

    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastStatus: text("last_status", { enum: ["SUCCESS", "FAILED"] }),
    lastError: text("last_error"),
    lastDurationMs: integer("last_duration_ms"),
    runCount: integer("run_count").notNull().default(0),
    failCount: integer("fail_count").notNull().default(0),

    /** Sewa: diisi saat pekerjaan direbut, dikosongkan saat selesai. Sewa
     *  kedaluwarsa boleh direbut worker lain — supaya worker yang mati tidak
     *  mengunci pekerjaan selamanya. */
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("scheduled_tasks_due_idx").on(table.isEnabled, table.lastRunAt)],
);

/** Riwayat eksekusi — append-only, untuk melihat kapan sebuah tugas berhenti. */
export const scheduledTaskRuns = pgTable(
  "scheduled_task_runs",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => scheduledTasks.id, { onDelete: "cascade" }),
    workerId: text("worker_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status", { enum: ["RUNNING", "SUCCESS", "FAILED"] })
      .notNull()
      .default("RUNNING"),
    detail: text("detail"),
    error: text("error"),
  },
  (table) => [index("scheduled_task_runs_task_idx").on(table.taskId, table.startedAt)],
);

/**
 * Sasaran probe. Keterjangkauan diukur lewat TCP connect, bukan ICMP: ping
 * butuh raw socket (hak root) yang tidak dimiliki proses aplikasi.
 * Konsekuensinya jujur — perangkat yang hidup tetapi portnya tertutup akan
 * terbaca DOWN, karena itu portnya dapat disetel per sasaran.
 */
export const probeTargets = pgTable(
  "probe_targets",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    address: text("address").notNull(),
    port: integer("port").notNull().default(443),
    assetId: text("asset_id").references(() => assets.assetId, {
      onDelete: "set null",
    }),
    severity: text("severity", { enum: ["warning", "critical"] })
      .notNull()
      .default("critical"),
    intervalSec: integer("interval_sec").notNull().default(60),
    timeoutMs: integer("timeout_ms").notNull().default(3000),
    /** Gagal berturut-turut sebelum alarm dinaikkan — supaya satu paket hilang
     *  tidak langsung membangunkan orang. */
    failThreshold: integer("fail_threshold").notNull().default(3),
    isActive: boolean("is_active").notNull().default(true),

    consecutiveFails: integer("consecutive_fails").notNull().default(0),
    lastStatus: text("last_status", { enum: ["UP", "DOWN"] }),
    lastLatencyMs: integer("last_latency_ms"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    /** Alarm yang sedang terbuka akibat sasaran ini — dipakai untuk auto-clear. */
    openAlarmId: text("open_alarm_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("probe_targets_active_idx").on(table.isActive, table.lastStatus)],
);

/** Hasil tiap pemeriksaan — append-only. */
export const probeResults = pgTable(
  "probe_results",
  {
    id: text("id").primaryKey(),
    targetId: text("target_id")
      .notNull()
      .references(() => probeTargets.id, { onDelete: "cascade" }),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: text("status", { enum: ["UP", "DOWN"] }).notNull(),
    latencyMs: integer("latency_ms"),
    error: text("error"),
  },
  (table) => [index("probe_results_target_idx").on(table.targetId, table.checkedAt)],
);

/**
 * Alarm jaringan — daur hidupnya terpisah dari `incidents`.
 *
 * `incidents` adalah apa yang DIKATAKAN LibreNMS lewat webhook; `network_alarms`
 * adalah apa yang portal ini SIMPULKAN sendiri (dari probe, dan nanti dari
 * sumber lain). Dipisah dengan sengaja: menggabungkannya berarti satu tabel
 * dengan dua pemilik, dan tidak akan jelas siapa yang berhak menutup baris.
 *
 * `dedupKey` mencegah satu gangguan yang sama melahirkan alarm beruntun.
 */
export const networkAlarms = pgTable(
  "network_alarms",
  {
    id: text("id").primaryKey(),
    alarmNumber: text("alarm_number").notNull().unique(),
    severity: text("severity", { enum: ["warning", "critical"] }).notNull(),
    source: text("source", { enum: ["PROBE", "LIBRENMS", "MANUAL"] }).notNull(),
    assetId: text("asset_id").references(() => assets.assetId, {
      onDelete: "set null",
    }),
    message: text("message").notNull(),
    /** Satu gangguan = satu baris. Alarm berulang menaikkan `count`.
     *  Keunikannya HANYA berlaku di antara alarm yang masih terbuka — lihat
     *  indeks parsial di bawah. Kalau dibuat unik global, sasaran yang mati
     *  untuk KEDUA kalinya tidak akan pernah bisa menaikkan alarm lagi. */
    dedupKey: text("dedup_key").notNull(),
    count: integer("count").notNull().default(1),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: text("acknowledged_by").references(() => user.id, {
      onDelete: "set null",
    }),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
  },
  (table) => [
    index("network_alarms_open_idx").on(table.clearedAt, table.occurredAt),
    // Unik hanya di antara yang BELUM ditutup: satu gangguan tidak boleh
    // melahirkan dua alarm terbuka sekaligus, tapi gangguan yang berulang
    // besok harus tetap bisa melahirkan alarm baru.
    uniqueIndex("network_alarms_dedup_open_idx")
      .on(table.dedupKey)
      .where(sql`${table.clearedAt} is null`),
  ],
);
