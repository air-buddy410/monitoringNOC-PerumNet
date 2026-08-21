// Laporan tidak boleh mengarang angka ke database yang terhubung.
//
// Sampai 21 Agustus 2026 komentar di kepala `reports.ts` menjanjikan
// "produksi/terhubung: seed tidak dijalankan", tapi hanya `ensureAssetsSeed`
// yang benar-benar berhenti. Kedua seed rekap tetap jalan dan menulis angka
// fixture — di produksi mereka membentur foreign key `assets` dan
// `GET /api/reports/sla` menjawab 500 sebanyak 24 kali.
//
// Yang diuji di sini BUKAN "tidak 500". Kalau foreign key itu suatu hari
// dilonggarkan, tidak-500 akan tetap hijau sementara angka karangan mengalir
// masuk dan menetap sebagai "hasil pengukuran" selamanya. Yang diuji adalah
// TABELNYA TETAP KOSONG.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  terhubung: true,
}));

vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/server/librenms", () => ({
  isLibrenmsConfigured: () => mocks.terhubung,
}));

import * as schema from "@/db/schema";
import { getSlaReport, getTrafficReport } from "@/server/reports";

const MIGRATION_DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const migrationSql = readdirSync(MIGRATION_DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(path.join(MIGRATION_DIR, file), "utf8"))
  .join("\n");

let client: PGlite;

async function hitung(tabel: string): Promise<number> {
  const r = await client.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${tabel}`);
  return r.rows[0].n;
}

beforeEach(async () => {
  client = new PGlite();
  await client.exec(migrationSql);
  mocks.db = drizzle(client, { schema });
});

afterEach(async () => {
  await client.close();
});

describe("terhubung ke LibreNMS (seperti produksi)", () => {
  beforeEach(() => {
    mocks.terhubung = true;
  });

  it("laporan SLA tidak menulis apa pun, dan tidak melempar", async () => {
    const hasil = await getSlaReport("2026-07");

    expect(await hitung("sla_monthly")).toBe(0);
    // `assets` juga tidak boleh kemasukan fixture — itu tabel produksi.
    expect(await hitung("assets")).toBe(0);
    expect(hasil.rows).toEqual([]);
  });

  it("laporan kosong MENGAKU kosong, bukan menyamar jadi nol", async () => {
    const hasil = await getSlaReport("2026-07");

    expect(hasil.source).toBe("belum-ada-data");
    // Inti perkaranya: "rata-rata uptime 0%" di layar NOC terbaca sebagai
    // jaringan yang mati total, bukan sebagai laporan yang belum punya isi.
    expect(hasil.summary.averageUptime).toBeNull();
    expect(hasil.summary.averageUptime).not.toBe(0);
    expect(hasil.summary.devices).toBe(0);
  });

  it("laporan trafik juga tidak menulis apa pun", async () => {
    const hasil = await getTrafficReport("2026-07");

    expect(await hitung("traffic_monthly")).toBe(0);
    expect(await hitung("assets")).toBe(0);
    expect(hasil.source).toBe("belum-ada-data");
    expect(hasil.rows).toEqual([]);
  });
});

describe("mode fixture (pengembangan, LibreNMS tidak di-set)", () => {
  beforeEach(() => {
    mocks.terhubung = false;
  });

  it("seed tetap jalan supaya layar dev punya isi", async () => {
    const hasil = await getSlaReport("2026-07");

    expect(await hitung("sla_monthly")).toBeGreaterThan(0);
    expect(hasil.rows.length).toBeGreaterThan(0);
    // Dan ia mengaku fixture — angkanya tidak pernah diukur.
    expect(hasil.source).toBe("fixture");
    expect(hasil.summary.averageUptime).not.toBeNull();
  });

  it("trafik: seed jalan dan mengaku fixture", async () => {
    const hasil = await getTrafficReport("2026-07");

    expect(await hitung("traffic_monthly")).toBeGreaterThan(0);
    expect(hasil.source).toBe("fixture");
  });
});
