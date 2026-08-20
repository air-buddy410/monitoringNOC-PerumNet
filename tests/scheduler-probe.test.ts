// Penjadwal + probe. PGlite in-memory dengan migrasi sungguhan.

import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));

import * as schema from "@/db/schema";
import {
  claimTask,
  clearRegistry,
  isDue,
  LEASE_TIMEOUT_MS,
  registerTask,
  runDueTasks,
  syncTaskRegistry,
} from "@/server/scheduler";
import { PROBE_TASKS, pruneProbeResults, runProbe, type Prober } from "@/server/probe";

const MIGRATION_DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const migrationSql = readdirSync(MIGRATION_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATION_DIR, f), "utf8"))
  .join("\n");

let client: PGlite;
const T0 = new Date("2026-08-20T00:00:00Z");

/** Prober palsu — tidak menyentuh jaringan sama sekali. */
const proberUp: Prober = async () => ({ status: "UP", latencyMs: 12 });
const proberDown: Prober = async () => ({
  status: "DOWN", latencyMs: null, error: "timeout",
});

async function buatTarget(over: Partial<typeof schema.probeTargets.$inferInsert> = {}) {
  const id = randomUUID();
  const nilai = {
    id, name: "OLT Kecicang", address: "192.168.100.10", port: 443,
    failThreshold: 3, ...over,
  };
  await client.query(
    `INSERT INTO probe_targets (id, name, address, port, fail_threshold)
     VALUES ($1, $2, $3, $4, $5)`,
    [nilai.id, nilai.name, nilai.address, nilai.port, nilai.failThreshold],
  );
  return id;
}

async function target(id: string) {
  const res = await client.query<{ consecutive_fails: number; last_status: string | null; open_alarm_id: string | null }>(
    "SELECT consecutive_fails, last_status, open_alarm_id FROM probe_targets WHERE id = $1", [id],
  );
  return res.rows[0];
}

async function hitung(sql: string): Promise<number> {
  const r = await client.query<{ n: string }>(sql);
  return Number(r.rows[0].n);
}

beforeAll(async () => {
  client = new PGlite();
  await client.exec(migrationSql);
  mocks.db = drizzle(client, { schema });
});

beforeEach(async () => {
  clearRegistry();
  await client.exec(`
    DELETE FROM probe_results; DELETE FROM network_alarms;
    DELETE FROM probe_targets; DELETE FROM scheduled_task_runs;
    DELETE FROM scheduled_tasks; DELETE FROM audit_logs;
  `);
});

describe("syncTaskRegistry", () => {
  it("membuat baris baru memakai enabledByDefault", async () => {
    registerTask({ code: "uji.baca", name: "Uji", description: "d",
      defaultIntervalSec: 60, enabledByDefault: true, run: async () => "ok" });
    registerTask({ code: "uji.tulis", name: "Uji2", description: "d",
      defaultIntervalSec: 60, enabledByDefault: false, run: async () => "ok" });
    await syncTaskRegistry();

    const r = await client.query<{ code: string; is_enabled: boolean }>(
      "SELECT code, is_enabled FROM scheduled_tasks ORDER BY code");
    expect(r.rows).toEqual([
      { code: "uji.baca", is_enabled: true },
      { code: "uji.tulis", is_enabled: false },
    ]);
  });

  // PELAJARAN TERMAHAL DARI CRM. Di sana lima pekerjaan sengaja dimatikan
  // operator, dan satu-satunya yang menahannya adalah baris database. Kalau
  // sync menimpa isEnabled, deploy biasa akan menyalakannya kembali diam-diam.
  it("TIDAK menimpa isEnabled yang sudah disetel operator", async () => {
    registerTask({ code: "uji.baca", name: "Uji", description: "lama",
      defaultIntervalSec: 60, enabledByDefault: true, run: async () => "ok" });
    await syncTaskRegistry();
    await client.query("UPDATE scheduled_tasks SET is_enabled = false, interval_sec = 999");

    clearRegistry();
    registerTask({ code: "uji.baca", name: "Uji diperbarui", description: "baru",
      defaultIntervalSec: 60, enabledByDefault: true, run: async () => "ok" });
    await syncTaskRegistry();

    const r = await client.query<{ is_enabled: boolean; interval_sec: number; name: string }>(
      "SELECT is_enabled, interval_sec, name FROM scheduled_tasks");
    expect(r.rows[0].is_enabled).toBe(false);   // tetap mati
    expect(r.rows[0].interval_sec).toBe(999);   // tetap milik operator
    expect(r.rows[0].name).toBe("Uji diperbarui"); // yang ini memang milik kode
  });
});

describe("isDue & sewa", () => {
  const dasar = { id: "x", code: "c", isEnabled: true, intervalSec: 60, lockedAt: null };

  it("belum pernah jalan → jatuh tempo", () => {
    expect(isDue({ ...dasar, lastRunAt: null }, T0)).toBe(true);
  });
  it("belum lewat interval → belum", () => {
    expect(isDue({ ...dasar, lastRunAt: new Date(T0.getTime() - 30_000) }, T0)).toBe(false);
  });
  it("dimatikan → tidak pernah jatuh tempo", () => {
    expect(isDue({ ...dasar, isEnabled: false, lastRunAt: null }, T0)).toBe(false);
  });

  it("dua worker tidak bisa sama-sama merebut", async () => {
    registerTask({ code: "uji", name: "U", description: "d",
      defaultIntervalSec: 60, enabledByDefault: true, run: async () => "ok" });
    await syncTaskRegistry();
    const [row] = (await client.query<{ id: string }>("SELECT id FROM scheduled_tasks")).rows;

    expect(await claimTask(row.id, "worker-1", T0)).toBe(true);
    expect(await claimTask(row.id, "worker-2", T0)).toBe(false);

    // Worker yang mati tidak boleh mengunci selamanya.
    const nanti = new Date(T0.getTime() + LEASE_TIMEOUT_MS + 1000);
    expect(await claimTask(row.id, "worker-2", nanti)).toBe(true);
  });
});

describe("runDueTasks", () => {
  it("mencatat SUCCESS dan melepas sewanya", async () => {
    registerTask({ code: "uji", name: "U", description: "d",
      defaultIntervalSec: 60, enabledByDefault: true, run: async () => "7 diperiksa" });
    await syncTaskRegistry();
    const hasil = await runDueTasks("w1", T0);

    expect(hasil).toEqual([expect.objectContaining({ code: "uji", status: "SUCCESS", detail: "7 diperiksa" })]);
    const r = await client.query<{ last_status: string; locked_at: string | null; run_count: number }>(
      "SELECT last_status, locked_at, run_count FROM scheduled_tasks");
    expect(r.rows[0].last_status).toBe("SUCCESS");
    expect(r.rows[0].locked_at).toBeNull();
    expect(r.rows[0].run_count).toBe(1);
  });

  // Satu tugas rusak tidak boleh menjatuhkan worker — tugas lain masih harus
  // jalan, dan kegagalannya harus jadi keadaan yang TERLIHAT, bukan log yang
  // tenggelam (WORKFLOW-TIM §4).
  it("tugas yang melempar dicatat FAILED, tidak menjatuhkan yang lain", async () => {
    registerTask({ code: "rusak", name: "R", description: "d", defaultIntervalSec: 60,
      enabledByDefault: true, run: async () => { throw new Error("koneksi putus"); } });
    registerTask({ code: "sehat", name: "S", description: "d", defaultIntervalSec: 60,
      enabledByDefault: true, run: async () => "ok" });
    await syncTaskRegistry();

    const hasil = await runDueTasks("w1", T0);
    expect(hasil).toHaveLength(2);
    expect(hasil.find((h) => h.code === "rusak")).toMatchObject({ status: "FAILED", error: "koneksi putus" });
    expect(hasil.find((h) => h.code === "sehat")).toMatchObject({ status: "SUCCESS" });

    const r = await client.query<{ last_error: string; fail_count: number }>(
      "SELECT last_error, fail_count FROM scheduled_tasks WHERE code = 'rusak'");
    expect(r.rows[0].last_error).toBe("koneksi putus");
    expect(r.rows[0].fail_count).toBe(1);
  });

  it("tugas yang dimatikan tidak dijalankan", async () => {
    registerTask({ code: "mati", name: "M", description: "d", defaultIntervalSec: 60,
      enabledByDefault: false, run: async () => { throw new Error("tidak boleh jalan"); } });
    await syncTaskRegistry();
    expect(await runDueTasks("w1", T0)).toEqual([]);
  });
});

describe("probe & daur hidup alarm", () => {
  it("gagal di bawah ambang: hitungan naik, alarm BELUM", async () => {
    const id = await buatTarget();
    await runProbe(id, { prober: proberDown, now: T0 });
    await runProbe(id, { prober: proberDown, now: T0 });

    const t = await target(id);
    expect(t.consecutive_fails).toBe(2);
    expect(t.open_alarm_id).toBeNull();
    expect(await hitung("SELECT count(*) AS n FROM network_alarms")).toBe(0);
  });

  it("mencapai ambang: SATU alarm, dan gagal berikutnya menaikkan count bukan baris", async () => {
    const id = await buatTarget();
    for (let i = 0; i < 5; i += 1) await runProbe(id, { prober: proberDown, now: T0 });

    expect(await hitung("SELECT count(*) AS n FROM network_alarms")).toBe(1);
    const a = await client.query<{ count: number; alarm_number: string; source: string }>(
      "SELECT count, alarm_number, source FROM network_alarms");
    expect(a.rows[0].count).toBe(3);          // 1 saat naik + 2 gagal berikutnya
    expect(a.rows[0].source).toBe("PROBE");
    expect(a.rows[0].alarm_number).toMatch(/^ALM-202608-0001$/);
  });

  it("pulih → alarm ditutup otomatis", async () => {
    const id = await buatTarget();
    for (let i = 0; i < 3; i += 1) await runProbe(id, { prober: proberDown, now: T0 });
    const r = await runProbe(id, { prober: proberUp, now: T0 });

    expect(r?.alarmCleared).toBe(true);
    expect((await target(id)).open_alarm_id).toBeNull();
    expect(await hitung("SELECT count(*) AS n FROM network_alarms WHERE cleared_at IS NULL")).toBe(0);
  });

  // Cacat yang tertangkap saat merancang: kalau dedup_key dibuat unik GLOBAL,
  // sasaran yang mati untuk kedua kalinya tidak akan pernah bisa beralarm lagi.
  // Keunikannya harus berlaku hanya di antara alarm yang masih terbuka.
  it("gangguan KEDUA setelah pulih tetap bisa menaikkan alarm baru", async () => {
    const id = await buatTarget();
    for (let i = 0; i < 3; i += 1) await runProbe(id, { prober: proberDown, now: T0 });
    await runProbe(id, { prober: proberUp, now: T0 });
    for (let i = 0; i < 3; i += 1) await runProbe(id, { prober: proberDown, now: T0 });

    expect(await hitung("SELECT count(*) AS n FROM network_alarms")).toBe(2);
    expect(await hitung("SELECT count(*) AS n FROM network_alarms WHERE cleared_at IS NULL")).toBe(1);
  });

  it("ambang dapat disetel per sasaran", async () => {
    const id = await buatTarget({ failThreshold: 1 });
    await runProbe(id, { prober: proberDown, now: T0 });
    expect(await hitung("SELECT count(*) AS n FROM network_alarms")).toBe(1);
  });

  it("hasil tiap pemeriksaan dicatat, dan yang lama dipangkas", async () => {
    const id = await buatTarget();
    await runProbe(id, { prober: proberUp, now: new Date(T0.getTime() - 30 * 86_400_000) });
    await runProbe(id, { prober: proberUp, now: T0 });
    expect(await hitung("SELECT count(*) AS n FROM probe_results")).toBe(2);

    expect(await pruneProbeResults(14, T0)).toBe(1);
    expect(await hitung("SELECT count(*) AS n FROM probe_results")).toBe(1);
  });

  it("ketiga tugas probe tidak BERTINDAK KELUAR, jadi boleh menyala secara bawaan", () => {
    // Daftar ini sengaja lengkap dan berurutan, bukan sekadar hitungan:
    // menambah tugas ke PROBE_TASKS harus memaksa seseorang membaca ulang
    // apakah tugas itu benar-benar boleh menyala sendiri.
    //
    // Ukurannya BUKAN "tidak menulis" — ketiganya menulis ke database portal
    // sendiri, dan itu memang diizinkan (docs/MODE-BACA-SAJA.md). Ukurannya
    // "tidak bertindak keluar": tidak mengubah konfigurasi perangkat, tidak
    // mengirim notifikasi, tidak mendorong data ke CRM/ALUS.
    //
    // `probe.sync` menulis baris probe_targets dan tidak menyentuh perangkat
    // sama sekali. Ia memang menyebabkan probe.run menyambung ke alamat baru,
    // tapi TCP connect yang langsung ditutup tidak mengubah apa pun — dan
    // probe.run sendiri sudah menyala secara bawaan sejak Fase 9.
    expect(PROBE_TASKS.map((t) => [t.code, t.enabledByDefault])).toEqual([
      ["probe.run", true],
      ["probe.sync", true],
      ["probe.prune", true],
    ]);
  });
});
