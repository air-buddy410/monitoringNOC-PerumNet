// Invarian baseline schema PostgreSQL (Fase 2): tabel wajib ada, tabel
// telemetry era SQLite tidak boleh ikut, dan index kunci harus terbentuk.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_DIR = path.resolve(__dirname, "..", "drizzle", "pg");

const sql = readdirSync(MIGRATION_DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(path.join(MIGRATION_DIR, file), "utf8"))
  .join("\n");

const REQUIRED_TABLES = [
  // domain portal
  "assets",
  "crm_service_mappings",
  "incidents",
  "audit_logs",
  "notification_deliveries",
  "topologies",
  "topology_nodes",
  "topology_links",
  "topology_discovery_suggestions",
  "topology_versions",
  // carry-over
  "notification_channels",
  "notification_logs",
  "sla_reports",
  "sla_monthly",
  "traffic_monthly",
  // OTB (Fase 11)
  "otb",
  "otb_trays",
  "otb_ports",
  // Kabel & core (Fase 12)
  "fiber_cable_segments",
  "fiber_cores",
  "fiber_core_terminations",
  // Closure & silangan (Fase 13)
  "fiber_closures",
  "fiber_core_splices",
  // auth
  "user",
  "session",
  "account",
  "verification",
];

const RETIRED_TABLES = [
  "device_metadata",
  "device_metrics",
  "port_metrics",
  "pon_port_samples",
  "onu_status_samples",
  "metric_history",
];

describe("baseline schema PostgreSQL", () => {
  it("seluruh tabel wajib dokumen tersedia", () => {
    for (const table of REQUIRED_TABLES) {
      expect(sql, `tabel ${table} hilang`).toMatch(
        new RegExp(`CREATE TABLE "${table}"`),
      );
    }
  });

  it("tabel telemetry era SQLite tidak ikut ke PostgreSQL", () => {
    for (const table of RETIRED_TABLES) {
      expect(sql).not.toMatch(new RegExp(`CREATE TABLE "${table}"`));
    }
  });

  it("idempotency incident: partial unique index untuk alert belum-resolved", () => {
    expect(sql).toContain("incidents_active_alert_idx");
    expect(sql).toMatch(/state.*<>.*'resolved'/);
  });

  it("kolom rename tuntas: tidak ada lagi kolom prtg_*", () => {
    expect(sql.toLowerCase()).not.toContain("prtg");
  });

  it("identitas port OTB dijaga index, bukan janji kode", () => {
    // Ketiganya bisa lupa dibuat tanpa satu pun tes lain merah — dan
    // kegagalannya baru terlihat saat ada dua "Core 17" di satu OTB produksi.
    expect(sql).toContain("otb_ports_otb_global_idx"); // satu Core 17 per OTB
    expect(sql).toContain("otb_ports_tray_number_idx"); // satu port per slot
    expect(sql).toContain("otb_trays_otb_number_idx");
  });

  it("otb_id pada port tidak bisa melenceng dari traynya", () => {
    // FK GABUNGAN. Kalau seseorang menggantinya dengan FK tray_id biasa
    // "supaya sederhana", port bisa mengaku milik OTB lain daripada traynya
    // dan keunikan nomor global se-OTB kehilangan artinya.
    expect(sql).toContain("otb_trays_id_otb_unique");
    expect(sql).toMatch(/FOREIGN KEY \("tray_id","otb_id"\)/);
  });

  it("okupansi core ditegakkan partial unique index, bukan kode", () => {
    // Ketiganya HARUS parsial (`where deactivated_at is null`). Tanpa klausa
    // itu, terminasi lama yang sudah dilepas ikut menghalangi port dipakai
    // lagi — dan penggantian kabel jadi mustahil tanpa menghapus riwayat.
    for (const idx of [
      "fiber_term_core_end_idx",
      "fiber_term_otb_port_idx",
      "fiber_term_odp_port_idx",
    ]) {
      expect(sql, `${idx} hilang`).toContain(idx);
    }
    const parsial = sql.match(/CREATE UNIQUE INDEX "fiber_term_[a-z_]+_idx"[^;]*/g) ?? [];
    expect(parsial).toHaveLength(3);
    for (const baris of parsial) {
      expect(baris, `${baris.slice(0, 60)} tidak parsial`).toMatch(
        /deactivated_at" is null/,
      );
    }
  });

  it("terminasi wajib menempel tepat di satu port", () => {
    // Tanpa CHECK ini, terminasi yang tidak menempel di mana pun bisa masuk:
    // tidak pernah ditemukan trace, tidak menimbulkan galat, dan baru
    // ketahuan saat ada yang menelusuri jalur yang putus.
    expect(sql).toContain("fiber_term_sasaran_check");
  });

  it("port yang membawa core tidak bisa dihapus — FK restrict, bukan cascade", () => {
    // Ini yang membuat aturan penurunan kapasitas Fase 11 tetap benar tanpa
    // satu baris pun diubah di sana. Diganti cascade, port berisi core akan
    // ikut terhapus diam-diam.
    expect(sql).toMatch(
      /"fiber_core_terminations_otb_port_id_otb_ports_id_fk"[\s\S]*?ON DELETE restrict/,
    );
    expect(sql).toMatch(
      /"fiber_core_terminations_odp_port_id_odp_ports_id_fk"[\s\S]*?ON DELETE restrict/,
    );
  });

  it("riwayat topologi punya index-nya — tabel append-only tidak pernah mengecil", () => {
    // Tanpa index ini layar riwayat memindai seluruh audit_logs, dan ia
    // melambat terus seiring umur sistem tanpa ada yang tahu kenapa.
    expect(sql).toContain("audit_logs_entity_idx");
    expect(sql).toContain("audit_logs_created_idx");
  });

  it("larangan membagi ditegakkan index, bukan kode", () => {
    // Satu ujung core masuk hanya boleh punya satu sambungan aktif. Kalau
    // index ini hilang, satu feeder bisa "bercabang" di closure biasa tanpa
    // splitter — dan setiap trace yang lewat situ jadi ambigu tanpa gejala.
    const parsial = sql.match(/CREATE UNIQUE INDEX "fiber_splice_[a-z_]+_idx"[^;]*/g) ?? [];
    expect(parsial).toHaveLength(2);
    for (const baris of parsial) {
      expect(baris).toMatch(/deactivated_at" is null/);
    }
    expect(sql).toContain("fiber_splice_input_idx");
    expect(sql).toContain("fiber_splice_output_idx");
    expect(sql).toContain("fiber_splice_bukan_diri_check");
  });

  it("closure dan core yang punya silangan tidak bisa dihapus", () => {
    for (const fk of [
      "fiber_core_splices_closure_id_fiber_closures_id_fk",
      "fiber_core_splices_input_core_id_fiber_cores_id_fk",
      "fiber_core_splices_output_core_id_fiber_cores_id_fk",
    ]) {
      expect(sql, `${fk} harus restrict`).toMatch(
        new RegExp(`"${fk}"[\\s\\S]*?ON DELETE restrict`),
      );
    }
  });

  it("relasi kunci: nodes→assets cascade, versions unik per (topology, version)", () => {
    expect(sql).toContain("topology_nodes_topology_asset_idx");
    expect(sql).toContain("topology_versions_topology_version_idx");
    expect(sql).toContain("crm_service_mappings_service_idx");
  });
});
