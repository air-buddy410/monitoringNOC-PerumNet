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
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
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
export const auditLogs = pgTable(
  "audit_logs",
  {
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
  },
  (table) => [
    // Riwayat sebuah entitas selalu dibaca sebagai "peristiwa X, terbaru
    // dulu". Tanpa index ini, layar riwayat memindai seluruh tabel — dan
    // tabel append-only tidak pernah mengecil, jadi ia melambat terus tanpa
    // ada yang tahu kenapa.
    index("audit_logs_entity_idx").on(
      table.entityType,
      table.entityId,
      table.createdAt.desc(),
    ),
    // Riwayat seluruh jaringan, terbaru dulu.
    index("audit_logs_created_idx").on(table.createdAt.desc()),
  ],
);

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

// ── Fase 10: situs, IPAM, FTTH, PPPoE, dan riwayat insiden ────────────────
//
// Menyusul fitur yang sudah ada di CRM. Satu keputusan yang membentuk seluruh
// bagian ini: **memperluas yang sudah ada, bukan membuat tandingannya.**
//
// CRM punya `NetworkDevice` dan `NetworkLink`. Portal ini SUDAH punya padanan
// keduanya — `assets` (inventaris perangkat dari LibreNMS) dan
// `topology_nodes`/`topology_links` (keterhubungan). Menambahkan tabel kembar
// hanya akan melahirkan dua daftar perangkat yang pelan-pelan berbeda isinya,
// dan tidak akan pernah jelas mana yang benar. Jadi yang ditambahkan di sini
// hanya yang benar-benar BELUM ada padanannya: situs, IPAM, FTTH, PPPoE, dan
// riwayat insiden.

/**
 * Lokasi fisik: POP, kantor, tower.
 *
 * `code` sengaja dibuat cocok dengan kolom teks `assets.site` yang sudah ada,
 * dan `assets` TIDAK diberi kolom `site_id`. Menambahkan FK berarti dua
 * representasi situs pada baris yang sama, dan cepat atau lambat keduanya akan
 * berbeda isinya tanpa ada yang tahu mana yang benar. Tautannya lunak dengan
 * sengaja: tabel ini memperkaya nama situs, bukan menggantikannya.
 */
export const networkSites = pgTable("network_sites", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  address: text("address"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Blok IP yang dikelola. `cidr` disimpan apa adanya (mis. 10.20.0.0/24). */
export const subnets = pgTable(
  "subnets",
  {
    id: text("id").primaryKey(),
    cidr: text("cidr").notNull().unique(),
    name: text("name").notNull(),
    gateway: text("gateway"),
    vlanId: integer("vlan_id"),
    siteId: text("site_id").references(() => networkSites.id, { onDelete: "set null" }),
    purpose: text("purpose"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("subnets_site_idx").on(table.siteId)],
);

/**
 * Satu alamat terpakai di dalam sebuah subnet.
 *
 * Unik per (subnet, address) — bukan per address saja: alamat privat yang sama
 * sah muncul di dua subnet berbeda, dan memaksakan keunikan global akan
 * menolak pencatatan yang benar.
 */
export const ipAddresses = pgTable(
  "ip_addresses",
  {
    id: text("id").primaryKey(),
    subnetId: text("subnet_id")
      .notNull()
      .references(() => subnets.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    assetId: text("asset_id").references(() => assets.assetId, { onDelete: "set null" }),
    label: text("label"),
    status: text("status", { enum: ["dipakai", "dicadangkan", "bebas"] })
      .notNull()
      .default("dipakai"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ip_addresses_subnet_address_idx").on(table.subnetId, table.address),
  ],
);

/** OLT — perangkat agregasi FTTH. Ditautkan ke `assets` bila ia juga terpantau. */
export const oltDevices = pgTable("olt_devices", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  managementIp: text("management_ip").notNull(),
  vendor: text("vendor"),
  model: text("model"),
  siteId: text("site_id").references(() => networkSites.id, { onDelete: "set null" }),
  assetId: text("asset_id").references(() => assets.assetId, { onDelete: "set null" }),
  /** Port konsol. Sebagian OLT tidak mendukung SNMP sama sekali dan hanya bisa
   *  dibaca lewat CLI; HSGQ di sini memakai 1023-1025, bukan 23. */
  telnetPort: integer("telnet_port"),
  /** NAMA env var yang memuat kredensial, bukan kredensialnya. Kata sandi
   *  perangkat tidak boleh tinggal di database — ia akan ikut ke setiap
   *  cadangan, dan cadangan berpindah tangan lebih sering daripada database. */
  credentialRef: text("credential_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** ODP — kotak terminasi di lapangan. */
export const odps = pgTable(
  "odps",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    siteId: text("site_id").references(() => networkSites.id, { onDelete: "set null" }),
    oltId: text("olt_id").references(() => oltDevices.id, { onDelete: "set null" }),
    /**
     * `MS` = master splitter (ODC / rumah kabel), `ODP` = terminasi lapangan.
     *
     * Keduanya sengaja di TABEL YANG SAMA, mengikuti CRM: keduanya punya port,
     * punya induk PON, dan bisa berkaskade. Yang membedakan hanya posisinya di
     * rantai — dan itu sudah ditentukan `parentId`, bukan oleh tabel terpisah.
     * `role` hanya untuk ikon dan penyaringan.
     */
    role: text("role", { enum: ["MS", "ODP"] }).notNull().default("ODP"),
    /** Induk kaskade: ODP di bawah MS, atau ODP di bawah ODP. */
    parentId: text("parent_id").references((): AnyPgColumn => odps.id, {
      onDelete: "set null",
    }),
    status: text("status"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    /** Kapasitas TOTAL port. Jumlah terpakai TIDAK disimpan di sini — ia
     *  diturunkan dari `odp_ports`, supaya tidak ada dua angka yang bisa
     *  berbeda tentang hal yang sama. */
    capacity: integer("capacity").notNull().default(8),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("odps_site_idx").on(table.siteId),
    index("odps_parent_idx").on(table.parentId),
  ],
);

/**
 * Pelanggan yang menempel pada sebuah ODP — TANPA satu pun data pribadi.
 *
 * Yang disimpan hanya `pppoe_username` (sudah ada di `pppoe_sessions`) dan ID
 * di sistem lain. Tidak ada nama, alamat, nomor, maupun koordinat: prinsip
 * yang sama dengan `odp_ports.external_service_id`, dan repo ini publik.
 *
 * Gunanya satu: menjawab "pelanggan ODP mana yang hilang dari sesi PPPoE".
 *
 * `subscription_status` WAJIB ikut, dan bukan kelengkapan. Dari 1.687
 * langganan yang menempel ODP, 113 berstatus ISOLATED/INACTIVE/PROSPECT —
 * mereka memang tidak online, selamanya. Tanpa kolom ini, satu ODP dengan 3
 * pelanggan terisolir akan terus-menerus dilaporkan sebagai gangguan massal,
 * dan fitur itu mati sebelum sempat dipakai.
 */
export const odpCustomers = pgTable(
  "odp_customers",
  {
    id: text("id").primaryKey(),
    odpId: text("odp_id")
      .notNull()
      .references(() => odps.id, { onDelete: "cascade" }),
    portNumber: integer("port_number"),
    pppoeUsername: text("pppoe_username").notNull().unique(),
    externalServiceId: text("external_service_id"),
    subscriptionStatus: text("subscription_status").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("odp_customers_odp_idx").on(table.odpId),
    index("odp_customers_status_idx").on(table.subscriptionStatus),
  ],
);

export const odpPorts = pgTable(
  "odp_ports",
  {
    id: text("id").primaryKey(),
    odpId: text("odp_id")
      .notNull()
      .references(() => odps.id, { onDelete: "cascade" }),
    portNumber: integer("port_number").notNull(),
    status: text("status", { enum: ["kosong", "terpakai", "rusak", "dicadangkan"] })
      .notNull()
      .default("kosong"),
    /** Identitas pelanggan di sistem LAIN (CRM/ALUS). Portal ini sengaja tidak
     *  menyimpan nama atau alamat pelanggan — repo ini publik. */
    externalServiceId: text("external_service_id"),
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("odp_ports_odp_number_idx").on(table.odpId, table.portNumber)],
);

/** Satu putaran penarikan sesi PPPoE dari router. */
export const pppoePollRuns = pgTable("pppoe_poll_runs", {
  id: text("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status", { enum: ["RUNNING", "SUCCESS", "FAILED", "SKIPPED"] })
    .notNull()
    .default("RUNNING"),
  sessionCount: integer("session_count").notNull().default(0),
  error: text("error"),
});

/**
 * Sesi PPPoE yang sedang aktif menurut penarikan terakhir.
 *
 * Yang disimpan sengaja hanya `username` — bukan nama, alamat, atau nomor
 * pelanggan. Repo ini publik, dan pemetaan username ke orang adalah milik CRM.
 */
export const pppoeSessions = pgTable(
  "pppoe_sessions",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    callerId: text("caller_id"),
    address: text("address"),
    uptimeSec: integer("uptime_sec"),
    routerName: text("router_name"),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
    pollRunId: text("poll_run_id").references(() => pppoePollRuns.id, {
      onDelete: "set null",
    }),
  },
  (table) => [uniqueIndex("pppoe_sessions_username_idx").on(table.username)],
);

/**
 * Riwayat sebuah insiden — catatan berurutan, append-only.
 *
 * Tanpa ini insiden cuma punya STATUS; dengan ini ia punya cerita. Saat
 * peninjauan pasca-gangguan, "kapan siapa tahu apa" hampir selalu pertanyaan
 * yang lebih berguna daripada "status akhirnya apa".
 */
export const incidentUpdates = pgTable(
  "incident_updates",
  {
    id: text("id").primaryKey(),
    incidentId: text("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    authorUserId: text("author_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** null = catatan sistem (mis. dinaikkan otomatis oleh probe). */
    authorLabel: text("author_label"),
    kind: text("kind", {
      enum: ["catatan", "status", "eskalasi", "penyebab", "penutupan"],
    })
      .notNull()
      .default("catatan"),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("incident_updates_incident_idx").on(table.incidentId, table.createdAt)],
);

// ───────────────────────────────────────────────────────────────────────────
// Trafik
// ───────────────────────────────────────────────────────────────────────────

/**
 * Interface router yang DIPANTAU trafiknya.
 *
 * Daftarnya tidak pernah ditulis di kode. Router ini punya 1.638 interface,
 * dan mayoritasnya `pppoe-in` dinamis yang **namanya adalah username
 * pelanggan** — repo ini publik, jadi nama-nama itu tidak boleh menyentuh
 * disk maupun baris log. Karena itu penemuannya hanya menyapu
 * `/rest/interface/ethernet` dan `/rest/interface/vlan`, dua resource yang
 * secara bentuk tidak pernah memuat interface pelanggan.
 *
 * `is_enabled`, `label`, `role`, `site_id`, dan `capacity_bps` adalah kolom
 * OPERATOR. Penemuan berkala tidak pernah menimpanya — doktrin yang sama
 * dengan `syncTaskRegistry`: deploy tidak boleh menyalakan kembali apa yang
 * sengaja dimatikan orang.
 */
export const trafficInterfaces = pgTable(
  "traffic_interfaces",
  {
    id: text("id").primaryKey(),
    routerName: text("router_name").notNull(),
    ifName: text("if_name").notNull(),
    /** `ether` atau `vlan` — dari resource mana ia ditemukan. */
    ifType: text("if_type"),
    label: text("label").notNull(),
    role: text("role", { enum: ["uplink", "site", "other"] })
      .notNull()
      .default("other"),
    siteId: text("site_id").references(() => networkSites.id, {
      onDelete: "set null",
    }),
    /**
     * Kapasitas port. Boleh null, dan bila null utilisasi persen TIDAK
     * dikirim — bukan 0. Bar 0% pada uplink 2,8 Gbps lebih menyesatkan
     * daripada tidak ada bar sama sekali.
     */
    capacityBps: doublePrecision("capacity_bps"),
    isEnabled: boolean("is_enabled").notNull().default(false),
    /** Terisi saat interface tidak lagi dijawab router; kosong lagi saat muncul. */
    missingSince: timestamp("missing_since", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("traffic_interfaces_key_idx").on(table.routerName, table.ifName),
    index("traffic_interfaces_enabled_idx").on(table.isEnabled),
  ],
);

/**
 * Satu titik laju.
 *
 * Sengaja TANPA kolom `id`, menyimpang dari seluruh skema lain: tabel ini
 * tumbuh ribuan baris per hari, dan kunci primer gabungan
 * `(interface_id, sampled_at)` PERSIS indeks yang dibutuhkan tiap kueri.
 * UUID beserta indeks uniknya adalah biaya tanpa pembeli.
 *
 * Counter mentah ikut disimpan. Kalau kelak ketahuan matematikanya salah,
 * lajunya bisa dihitung ulang dari sini; tanpa itu, satu bug matematika
 * berarti data yang sudah masuk hilang selamanya.
 */
export const trafficSamples = pgTable(
  "traffic_samples",
  {
    interfaceId: text("interface_id")
      .notNull()
      .references(() => trafficInterfaces.id, { onDelete: "cascade" }),
    sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull(),
    rxBps: doublePrecision("rx_bps").notNull(),
    txBps: doublePrecision("tx_bps").notNull(),
    rxByte: bigint("rx_byte", { mode: "bigint" }).notNull(),
    txByte: bigint("tx_byte", { mode: "bigint" }).notNull(),
    /** Jarak waktu nyata ke cuplikan sebelumnya — bukan interval yang diasumsikan. */
    dtMs: integer("dt_ms").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.interfaceId, table.sampledAt] }),
  ],
);

// ───────────────────────────────────────────────────────────────────────────
// Layar TV
// ───────────────────────────────────────────────────────────────────────────

/**
 * Token untuk layar TV wallboard.
 *
 * **Token polosnya tidak pernah disimpan** — hanya SHA-256-nya. Yang bocor
 * dari database tidak bisa dipakai membuka layar.
 *
 * SHA-256, bukan bcrypt/argon2, dan itu disengaja: ini rahasia acak 256 bit,
 * bukan kata sandi manusia. Tidak ada yang bisa ditebak beruntun, jadi hash
 * lambat tidak membeli apa pun — sementara hash ber-salt tidak bisa
 * diindeks, sehingga verifikasi harus memindai seluruh tabel. Ini pola kunci
 * API, dan pilihannya memang berbeda dari kata sandi.
 *
 * `expires_at` WAJIB. Token abadi di dalam URL adalah kredensial permanen di
 * riwayat browser sebuah TV yang siapa pun bisa sentuh.
 */
export const tvTokens = pgTable("tv_tokens", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  /** Delapan karakter awal, supaya token bisa dikenali tanpa menyimpannya. */
  tokenPrefix: text("token_prefix").notNull(),
  createdBy: text("created_by").references(() => user.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  useCount: integer("use_count").notNull().default(0),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: text("revoked_by").references(() => user.id, {
    onDelete: "set null",
  }),
});

// ---------------------------------------------------------------------------
// OTB — Optical Termination Box: tray dan port fisik (Fase 11).
// ---------------------------------------------------------------------------

/**
 * Kosakata status port OTB — satu daftar, dipakai skema DAN validasi.
 *
 * Empat nilai pertama sudah dipakai `odp_ports` sejak Fase 10 dan sudah tampil
 * di layar `/ftth`. Membuat kosakata kedua khusus OTB berarti satu konsep punya
 * dua daftar kata dan UI harus menghafal keduanya beserta pemetaan warnanya —
 * itu selalu berakhir dengan satu layar yang lupa sebagian.
 *
 * Yang ditambah hanya `nonaktif`: port utuh yang sengaja dikeluarkan dari
 * layanan. Tanpa itu lencana "Tidak Aktif" pada tray tidak bisa diturunkan.
 *
 * `faulty` dan `damaged` dari PRD sengaja DILEBUR jadi `rusak`. Bedanya tidak
 * mengubah satu pun keputusan operasional — port rusak tidak boleh
 * dialokasikan, titik — sementara dua kata untuk satu keadaan menjamin ada
 * query yang kelak hanya ingat salah satunya. Derajat kerusakan ditulis di
 * `notes`, tempat yang memang untuk kalimat.
 *
 * Diekspor supaya route memvalidasi terhadap daftar yang SAMA dengan kolomnya.
 * Kolomnya `text`, jadi tanpa validasi PostgreSQL akan menerima `"terpaki"`
 * dengan senang hati dan port itu hilang dari semua pencacah selamanya.
 */
export const STATUS_PORT_OTB = [
  "kosong",
  "terpakai",
  "dicadangkan",
  "rusak",
  "nonaktif",
] as const;

/**
 * OTB: kotak terminasi tempat kabel feeder diurai jadi core per port.
 *
 * Ini rak, bukan titik jaringan. Yang bisa ditelusuri adalah PORT-nya, dan
 * port hidup di dalam tray — itulah sebabnya tabel ini nyaris tidak menyimpan
 * angka apa pun sendiri.
 *
 * **Jumlah tray dan jumlah port TIDAK disimpan di sini.** Keduanya dihitung
 * dari baris `otb_trays` dan `otb_ports`. Prinsipnya sama dengan
 * `odps.capacity` vs `usedPorts`: jangan pernah ada dua angka yang bisa
 * berbeda tentang hal yang sama. Yang tersimpan hanyalah `default*` di bawah —
 * itu NIAT saat membuat tray baru, bukan hitungan, jadi ia memang tidak bisa
 * diturunkan dari mana pun.
 *
 * `defaultConnectorType` menentukan kapasitas bawaan tray: SC = 12 port,
 * LC = 24 port (PRD FR-OTB-002). Itu default aplikasi, BUKAN batas database —
 * tray boleh dibuat dengan jumlah port lain, dan skema ini tidak menghalangi.
 *
 * Koordinat: OTB di dalam POP memakai koordinat situsnya, OTB tunggal di tiang
 * memakai koordinatnya sendiri. Keduanya boleh terisi dan itu bukan
 * pertentangan — koordinat di sini MENIMPA koordinat situs kalau ada. Yang
 * dilarang adalah kosong dua-duanya; OTB tanpa keduanya tidak akan pernah bisa
 * muncul di peta, dan itu diperiksa di `src/server/otb-store.ts`.
 */
export const otb = pgTable(
  "otb",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    siteId: text("site_id").references(() => networkSites.id, {
      onDelete: "set null",
    }),
    /** Konektor bawaan untuk tray baru. Konektor sesungguhnya ada di tray. */
    defaultConnectorType: text("default_connector_type", { enum: ["SC", "LC"] })
      .notNull()
      .default("LC"),
    /**
     * Polish bawaan untuk tray baru. Sengaja KOLOM TERPISAH dari konektor
     * walaupun layar menampilkannya sebagai "LC/APC": digabung jadi satu teks,
     * pertanyaan "mana saja yang APC" hanya bisa dijawab dengan mengurai
     * string, dan itu selalu berakhir salah.
     */
    defaultPolish: text("default_polish", { enum: ["UPC", "APC"] })
      .notNull()
      .default("APC"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    status: text("status", { enum: ["aktif", "nonaktif"] })
      .notNull()
      .default("aktif"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("otb_site_idx").on(table.siteId)],
);

/**
 * Satu laci di dalam OTB.
 *
 * `tray_number` adalah KOLOM, bukan urutan baris. Tray yang dicabut dari rak
 * itu kejadian nyata, dan nomor tray tetangganya tidak boleh ikut bergeser
 * karenanya — nomor tray tercetak di badan rak dan dipakai teknisi di lapangan
 * untuk menemukan port. Karena itu deretan tray boleh berlubang (1,2,3,5,…)
 * dan itu sah.
 *
 * Konektor dan polish ada DI SINI, bukan di OTB, karena inilah kenyataan
 * fisiknya: satu rak bisa memuat tray SC dan tray LC sekaligus. `otb.default*`
 * hanya mengisi nilai awal saat tray dibuat.
 *
 * Jumlah port tray tidak disimpan — ia adalah jumlah baris `otb_ports`.
 */
export const otbTrays = pgTable(
  "otb_trays",
  {
    id: text("id").primaryKey(),
    otbId: text("otb_id")
      .notNull()
      .references(() => otb.id, { onDelete: "cascade" }),
    trayNumber: integer("tray_number").notNull(),
    connectorType: text("connector_type", { enum: ["SC", "LC"] }).notNull(),
    polish: text("polish", { enum: ["UPC", "APC"] }).notNull(),
    label: text("label"),
    status: text("status", { enum: ["aktif", "nonaktif"] })
      .notNull()
      .default("aktif"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("otb_trays_otb_number_idx").on(table.otbId, table.trayNumber),
    // Terlihat mubazir — `id` sudah primary key — tapi dialah satu-satunya yang
    // membuat FK GABUNGAN di `otb_ports` mungkin. Lihat komentar di sana.
    unique("otb_trays_id_otb_unique").on(table.id, table.otbId),
  ],
);

/**
 * Port fisik di dalam sebuah tray — identitas permanen (PRD FR-OTB-003).
 *
 * Dua penomoran, dan keduanya wajib:
 *
 * - `port_number_in_tray` — yang tercetak di tray dan dipakai teknisi.
 * - `global_port_number` — nomor berurut se-OTB, yang dipakai dokumen lama
 *   dan label di lapangan. Layar menyebutnya "Core 17 (Port 17)".
 *
 * Nomor global DISIMPAN, tidak dihitung ulang dari kapasitas tray. Kalau ia
 * diturunkan, menambah satu port di tray 1 akan menggeser nomor seluruh port
 * di tray 2 ke atas — dan setiap label yang sudah tertempel di lapangan
 * seketika menunjuk port yang salah. Nomor yang sudah terbit tidak boleh
 * bergerak, jadi deretannya boleh berlubang setelah kapasitas pernah diubah.
 *
 * `otb_id` sengaja diduplikasi dari tray-nya. Bukan demi kecepatan: tanpa ia,
 * keunikan nomor global se-OTB tidak bisa dinyatakan sebagai constraint sama
 * sekali, dan harus dijaga oleh kode aplikasi yang bisa lupa.
 *
 * `status` memakai `STATUS_PORT_OTB` — kosakata yang sama dengan `odp_ports`
 * ditambah `nonaktif`. Lihat alasannya di sana.
 *
 * `external_service_id` = identitas layanan di sistem LAIN (CRM/ALUS). Portal
 * ini tidak menyimpan nama maupun alamat pelanggan — repo ini publik.
 */
export const otbPorts = pgTable(
  "otb_ports",
  {
    id: text("id").primaryKey(),
    trayId: text("tray_id").notNull(),
    otbId: text("otb_id")
      .notNull()
      .references(() => otb.id, { onDelete: "cascade" }),
    portNumberInTray: integer("port_number_in_tray").notNull(),
    globalPortNumber: integer("global_port_number").notNull(),
    status: text("status", { enum: STATUS_PORT_OTB }).notNull().default("kosong"),
    externalServiceId: text("external_service_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("otb_ports_tray_number_idx").on(
      table.trayId,
      table.portNumberInTray,
    ),
    uniqueIndex("otb_ports_otb_global_idx").on(
      table.otbId,
      table.globalPortNumber,
    ),
    index("otb_ports_otb_idx").on(table.otbId),
    // FK GABUNGAN, bukan `tray_id` biasa: ia sekaligus memaksa `otb_id` port
    // sama dengan `otb_id` tray-nya. Tanpa ini, duplikasi `otb_id` di atas
    // hanyalah janji kode aplikasi — dan janji semacam itu ditepati sampai
    // suatu hari tidak. Duplikasi yang dijaga database bukan denormalisasi.
    foreignKey({
      name: "otb_ports_tray_fk",
      columns: [table.trayId, table.otbId],
      foreignColumns: [otbTrays.id, otbTrays.otbId],
    }).onDelete("cascade"),
  ],
);

// ---------------------------------------------------------------------------
// Kabel, core, dan terminasi core (Fase 12).
// ---------------------------------------------------------------------------

/**
 * Urutan warna core standar TIA-598-C.
 *
 * Dipakai untuk MENGISI `fiber_cores.color` saat kabel dibuat, bukan untuk
 * menggantikannya. Sebagian vendor memakai urutan sendiri, dan yang tercetak
 * di kabel selalu lebih benar daripada standar — karena itu warnanya disimpan
 * sebagai kolom yang bisa ditimpa, bukan dihitung ulang tiap kali dibaca.
 *
 * Core ke-13 dan seterusnya mengulang urutan yang sama; di lapangan
 * pembedanya adalah tabung (`tube_number`), bukan warnanya.
 */
export const WARNA_CORE = [
  "biru",
  "jingga",
  "hijau",
  "coklat",
  "abu-abu",
  "putih",
  "merah",
  "hitam",
  "kuning",
  "ungu",
  "merah muda",
  "tosca",
] as const;

/**
 * Satu bentangan kabel fisik.
 *
 * **Tidak punya kolom ujung A dan ujung B.** Kabel ini tersambung ke apa
 * ditentukan oleh terminasi core-nya, dan menyimpannya lagi di sini berarti
 * dua jawaban untuk satu pertanyaan — yang cepat atau lambat akan berbeda.
 * Konsekuensinya diterima dengan sadar: kabel yang belum satu pun core-nya
 * diterminasi memang belum punya ujung yang diketahui, dan Fase 15 harus
 * menampilkannya sebagai peringatan, bukan menggambar garis tebakan.
 *
 * `length_m` dalam METER dan boleh NULL. Meter, bukan kilometer pecahan,
 * karena angkanya datang dari catatan lapangan dan OTDR dalam meter — dan
 * kilometer pecahan mengundang pembulatan yang menumpuk sepanjang jalur.
 * NULL berarti **belum diukur**, dan itu bukan hal yang sama dengan 0.
 * Jangan pernah menggantinya dengan 0 supaya penjumlahan "rapi".
 *
 * `fiber_type` ada di sini, bukan di core: satu bentangan kabel berisi satu
 * jenis serat. Layar boleh menampilkannya di panel core; sumbernya tetap
 * kabelnya.
 */
export const fiberCableSegments = pgTable(
  "fiber_cable_segments",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name"),
    /**
     * Fungsi fisik kabel, sengaja terpisah dari `fiber_cores.purpose`.
     * Sebuah kabel feeder boleh membawa core yang dipakai untuk distribusi
     * pada sebagian seratnya; menyatukan keduanya menghapus perbedaan itu.
     */
    category: text("category", {
      enum: [
        "backbone",
        "feeder",
        "distribution",
        "dropcore",
        "interconnect",
        "lain",
      ],
    }).notNull(),
    fiberType: text("fiber_type", {
      enum: ["G.652D", "G.657A1", "G.657A2", "lain"],
    })
      .notNull()
      .default("G.652D"),
    coreCount: integer("core_count").notNull(),
    /** Meter. NULL = belum diukur — bukan nol. */
    lengthM: integer("length_m"),
    status: text("status", { enum: ["aktif", "nonaktif"] })
      .notNull()
      .default("aktif"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("fiber_cable_segments_category_idx").on(table.category)],
);

/**
 * Satu serat di dalam satu bentangan kabel.
 *
 * `purpose` menegakkan pemisahan feeder dan distribution yang jadi inti
 * seluruh modul ini (PRD §3). Ia diperiksa saat terminasi, bukan hanya
 * ditampilkan: core feeder tidak boleh berakhir di port ODP.
 *
 * Sebuah core punya DUA ujung, `A` dan `B`, dan tiap ujung diterminasi
 * sendiri-sendiri — lihat `fiber_core_terminations`. Mana yang A dan mana
 * yang B tidak punya makna geografis; ia hanya cara menyebut dua ujung yang
 * berbeda secara konsisten.
 */
export const fiberCores = pgTable(
  "fiber_cores",
  {
    id: text("id").primaryKey(),
    segmentId: text("segment_id")
      .notNull()
      .references(() => fiberCableSegments.id, { onDelete: "cascade" }),
    coreNumber: integer("core_number").notNull(),
    /** Tabung/loose tube tempat core ini berada. NULL untuk kabel tanpa tabung. */
    tubeNumber: integer("tube_number"),
    /**
     * Posisi core DI DALAM tabungnya — penomoran KEDUA, dan ia wajib ada
     * karena catatan lapangan memang memakai dua sekaligus.
     *
     * Sheet `Alokasi Core 144` menomori tiap serat dua kali: FO ID berurut
     * 1–144 se-kabel, DAN "TUBE 5 CORE 3" di dalam tabungnya. Model yang
     * hanya menyimpan satu di antaranya tidak bisa menolak kesalahan yang
     * sudah ada di sheet itu: `TUBE 5 - CORE 5` muncul dua kali (FO ID 52 dan
     * 53), dan karena FO ID-nya berbeda, `core_number` yang unik per segmen
     * meloloskannya.
     *
     * Catatan CRM sendiri menyebut nomor core ganda dalam satu tabung
     * "seharusnya ditolak constraint database". Kolom ini yang membuatnya
     * bisa. NULL untuk kabel yang memang tidak bertabung.
     */
    coreInTube: integer("core_in_tube"),
    /** Diisi dari WARNA_CORE saat kabel dibuat; boleh ditimpa. */
    color: text("color"),
    purpose: text("purpose", { enum: ["feeder", "distribution"] }).notNull(),
    /** Label/KSN yang tertulis di lapangan, kalau ada. */
    label: text("label"),
    status: text("status", { enum: ["baik", "rusak", "nonaktif"] })
      .notNull()
      .default("baik"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("fiber_cores_segment_number_idx").on(
      table.segmentId,
      table.coreNumber,
    ),
    // Satu posisi dalam satu tabung, satu core. Parsial supaya kabel tanpa
    // tabung — dropcore, patch — tetap sah tanpa mengarang nomor tabung.
    uniqueIndex("fiber_cores_tube_pos_idx")
      .on(table.segmentId, table.tubeNumber, table.coreInTube)
      .where(sql`${table.tubeNumber} is not null and ${table.coreInTube} is not null`),
    index("fiber_cores_purpose_idx").on(table.purpose),
  ],
);

/**
 * Ujung sebuah core yang berakhir di sebuah port.
 *
 * **Tabel ini adalah okupansi.** Tiga aturan yang selama ini hanya bisa
 * dijanjikan kode aplikasi sekarang ditegakkan PostgreSQL, lewat *partial
 * unique index* yang hanya berlaku pada baris aktif (`deactivated_at IS
 * NULL`) — pola yang sudah dipakai `incidents_active_alert_idx`:
 *
 *   1. Satu ujung core hanya punya satu terminasi aktif.
 *   2. Satu port OTB hanya ditempati satu terminasi aktif.
 *   3. Satu port ODP hanya ditempati satu terminasi aktif.
 *
 * Ini yang membuat dua operator yang menekan simpan bersamaan tidak bisa
 * menghasilkan okupansi ganda. Pemeriksaan di kode tetap ada supaya pesannya
 * bisa dibaca manusia, tapi yang MENJAMIN adalah index ini.
 *
 * **Penggantian tidak menimpa.** Terminasi lama diberi `deactivated_at` dan
 * alasannya, lalu terminasi baru dibuat sebagai baris tersendiri (PRD §3
 * aturan 7). Karena index-nya parsial, baris lama otomatis keluar dari
 * perhitungan okupansi tanpa perlu dihapus.
 *
 * Sasarannya polimorfik — port OTB atau port ODP — dan itu dijaga CHECK,
 * bukan kesepakatan. Dua-duanya NULL berarti terminasi yang tidak menempel di
 * mana pun: ia tidak akan pernah ditemukan trace, tidak menimbulkan galat,
 * dan tidak akan ada yang tahu sampai seseorang menelusuri jalur yang putus.
 *
 * FK ke port memakai `restrict`, BUKAN `cascade`, dan itu disengaja: ia yang
 * membuat aturan penurunan kapasitas tray di Fase 11 tetap benar tanpa satu
 * baris pun diubah — port yang punya core terpasang tidak bisa dihapus.
 */
export const fiberCoreTerminations = pgTable(
  "fiber_core_terminations",
  {
    id: text("id").primaryKey(),
    coreId: text("core_id")
      .notNull()
      .references(() => fiberCores.id, { onDelete: "restrict" }),
    coreEnd: text("core_end", { enum: ["A", "B"] }).notNull(),
    otbPortId: text("otb_port_id").references(() => otbPorts.id, {
      onDelete: "restrict",
    }),
    odpPortId: text("odp_port_id").references(() => odpPorts.id, {
      onDelete: "restrict",
    }),
    /** Alasan perubahan — wajib. PRD §6.3: mutasi topologi tanpa alasan
     *  membuat audit bisa menjawab "apa" tapi tidak pernah "kenapa". */
    reason: text("reason").notNull(),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    deactivatedReason: text("deactivated_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("fiber_term_core_end_idx")
      .on(table.coreId, table.coreEnd)
      .where(sql`${table.deactivatedAt} is null`),
    uniqueIndex("fiber_term_otb_port_idx")
      .on(table.otbPortId)
      .where(sql`${table.deactivatedAt} is null`),
    uniqueIndex("fiber_term_odp_port_idx")
      .on(table.odpPortId)
      .where(sql`${table.deactivatedAt} is null`),
    index("fiber_term_core_idx").on(table.coreId),
    check(
      "fiber_term_sasaran_check",
      sql`(${table.otbPortId} is not null and ${table.odpPortId} is null)
       or (${table.otbPortId} is null and ${table.odpPortId} is not null)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Closure dan silangan core (Fase 13).
// ---------------------------------------------------------------------------

/**
 * Closure — sambungan di lapangan tempat core dari dua kabel disambung.
 *
 * Aturan lokasinya sama dengan `otb`: kalau tidak menempel pada situs, ia
 * WAJIB punya koordinat sendiri. Closure yang tidak bisa ditemukan di peta
 * tidak ada gunanya bagi orang yang sedang mencari titik putus jam tiga pagi.
 *
 * `type` sengaja dibedakan walau keduanya diperlakukan sama oleh aturan
 * silangan: `inline` disambung di tengah bentangan, `dome` di ujung. Bedanya
 * penting bagi teknisi yang membawa perkakas, bukan bagi trace.
 *
 * **Closure TIDAK boleh membagi satu core jadi beberapa** (PRD §3 aturan 2).
 * Larangan itu tidak ditulis di sini sebagai kolom — ia ditegakkan index unik
 * di `fiber_core_splices`. Kolom "boleh membagi" akan jadi saklar yang cepat
 * atau lambat dinyalakan seseorang.
 */
export const fiberClosures = pgTable(
  "fiber_closures",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name"),
    siteId: text("site_id").references(() => networkSites.id, {
      onDelete: "set null",
    }),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    type: text("type", { enum: ["inline", "dome", "lain"] })
      .notNull()
      .default("inline"),
    status: text("status", { enum: ["aktif", "nonaktif"] })
      .notNull()
      .default("aktif"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("fiber_closures_site_idx").on(table.siteId)],
);

/**
 * Satu sambungan core di dalam closure: ujung core masuk → ujung core keluar.
 *
 * Inilah yang membuat "Core 17 menjadi Core 23" bisa dicatat sebagai
 * kenyataan, bukan catatan pinggir. Nomor core BOLEH berubah saat melewati
 * closure (PRD §3.1), dan trace wajib mengikuti nomor yang baru.
 *
 * **Larangan membagi ditegakkan di sini, bukan di closure-nya.**
 * `fiber_splice_input_idx` memastikan satu ujung core masuk hanya punya SATU
 * sambungan aktif. Percobaan membagi satu core jadi dua akan ditolak
 * PostgreSQL, bukan hanya oleh kode — dan bukan hanya disembunyikan dari
 * layar. Pembagian optik hanya boleh lewat master splitter yang eksplisit.
 *
 * Arah "masuk" dan "keluar" adalah arah TELUSUR (feeder menuju pelanggan),
 * bukan sifat fisik: sambungan fusi itu simetris. Arah disimpan supaya trace
 * punya urutan yang pasti.
 *
 * **Yang TIDAK dijamin database, dan harus dijaga `fiber-store.ts`:** sebuah
 * ujung core dipakai sebagai `input` pada satu sambungan DAN sebagai `output`
 * pada sambungan lain. Kedua index di bawah masing-masing hanya melihat satu
 * kolom, dan keunikan lintas-kolom tidak bisa dinyatakan sebagai index biasa.
 * Begitu pula "ujung ini sudah diterminasi di `fiber_core_terminations`" —
 * itu tabel lain. Keduanya diperiksa di store dan punya tesnya sendiri; jangan
 * menganggap index sudah menutup semuanya.
 *
 * `estimated_loss_db` bernama demikian dengan sengaja. Ia model, bukan hasil
 * ukur. PRD §3 aturan 6: estimasi tidak boleh dilabeli pengukuran, dan nama
 * kolom adalah label yang paling sering dibaca orang.
 */
export const fiberCoreSplices = pgTable(
  "fiber_core_splices",
  {
    id: text("id").primaryKey(),
    closureId: text("closure_id")
      .notNull()
      .references(() => fiberClosures.id, { onDelete: "restrict" }),
    inputCoreId: text("input_core_id")
      .notNull()
      .references(() => fiberCores.id, { onDelete: "restrict" }),
    inputCoreEnd: text("input_core_end", { enum: ["A", "B"] }).notNull(),
    outputCoreId: text("output_core_id")
      .notNull()
      .references(() => fiberCores.id, { onDelete: "restrict" }),
    outputCoreEnd: text("output_core_end", { enum: ["A", "B"] }).notNull(),
    /** Estimasi rugi sambungan dalam dB — model, BUKAN hasil ukur. */
    estimatedLossDb: doublePrecision("estimated_loss_db"),
    reason: text("reason").notNull(),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    deactivatedReason: text("deactivated_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Larangan membagi: satu ujung masuk, satu sambungan aktif.
    uniqueIndex("fiber_splice_input_idx")
      .on(table.inputCoreId, table.inputCoreEnd)
      .where(sql`${table.deactivatedAt} is null`),
    // Satu ujung keluar hanya ditempati satu sambungan aktif.
    uniqueIndex("fiber_splice_output_idx")
      .on(table.outputCoreId, table.outputCoreEnd)
      .where(sql`${table.deactivatedAt} is null`),
    index("fiber_splice_closure_idx").on(table.closureId),
    // Core tidak bisa disambung ke dirinya sendiri pada ujung yang sama.
    // Ujung A ke ujung B core yang sama secara fisik adalah loop sepanjang
    // satu kabel — mustahil, dan kalau lolos ia membuat trace berputar.
    check(
      "fiber_splice_bukan_diri_check",
      sql`${table.inputCoreId} <> ${table.outputCoreId}`,
    ),
  ],
);

/**
 * Cuplikan CPU, RAM, dan suhu per perangkat.
 *
 * Ada karena portal ini menampilkan grafik riwayat tapi tidak pernah
 * menyimpan riwayatnya: tabel telemetry era SQLite dipensiunkan pada Fase 2
 * dan tidak pernah diganti, sehingga `/api/devices/:id/metrics-history`
 * mengarang deretnya sampai 22 Agustus 2026. LibreNMS memuat nilai SEKARANG,
 * bukan deretnya — jadi kalau tidak dicuplik, ia hilang.
 *
 * Bentuknya sengaja meniru `traffic_samples`, yang sudah terbukti: kunci
 * gabungan (perangkat, waktu), pemangkasan berjadwal, dan tanpa kolom
 * turunan.
 *
 * **Ketiga nilainya boleh NULL, dan itu intinya.** Sebagian perangkat hanya
 * melaporkan salah satu — LibreNMS bisa memberi CPU tanpa memori. Menyimpan
 * yang tidak terbaca sebagai 0 menghasilkan garis datar 0% yang terbaca
 * sebagai "hemat", bukan "tidak terbaca". Baris yang KETIGA nilainya null
 * tidak ditulis sama sekali.
 */
export const deviceMetricSamples = pgTable(
  "device_metric_samples",
  {
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.assetId, { onDelete: "cascade" }),
    sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull(),
    cpuPercent: doublePrecision("cpu_percent"),
    ramPercent: doublePrecision("ram_percent"),
    tempCelsius: doublePrecision("temp_celsius"),
  },
  (table) => [
    primaryKey({ columns: [table.assetId, table.sampledAt] }),
    // Deret satu perangkat, terbaru dulu — bentuk baca satu-satunya.
    index("device_metric_samples_asset_idx").on(
      table.assetId,
      table.sampledAt.desc(),
    ),
  ],
);
