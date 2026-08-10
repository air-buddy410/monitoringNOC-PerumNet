// Idempotensi webhook alert → tabel incidents (Fase 4).
// Menggunakan PGlite in-memory (tanpa file, bebas lock) yang di-seed dari
// migration SQL baseline drizzle/pg — tanpa menyentuh server nyata.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/db", () => ({ get db() { return mocks.db; } }));

import * as schema from "@/db/schema";
import { applyLibrenmsAlert } from "@/server/incident-store";
import type { NormalizedLibrenmsAlert } from "@/server/librenms/alert";

const MIGRATION_DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const migrationSql = readdirSync(MIGRATION_DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(path.join(MIGRATION_DIR, file), "utf8"))
  .join("\n");

let client: PGlite;

beforeAll(async () => {
  client = new PGlite();
  await client.exec(migrationSql);
  mocks.db = drizzle(client, { schema });
});

const firing: NormalizedLibrenmsAlert = {
  librenmsAlertId: "alert-42",
  librenmsDeviceId: 1,
  deviceName: "core-menteng-01",
  severity: "critical",
  state: "alerting",
  message: "Device down",
  timestamp: "2026-08-10T07:00:00Z",
};

async function countIncidents() {
  const result = await client.query<{ n: string }>("SELECT count(*) AS n FROM incidents");
  return Number(result.rows[0].n);
}

async function firstIncident() {
  const result = await client.query<{
    librenms_alert_id: string;
    state: string;
    severity: string;
    message: string;
  }>("SELECT librenms_alert_id, state, severity, message FROM incidents LIMIT 1");
  return result.rows[0];
}

describe("applyLibrenmsAlert — idempotensi", () => {
  it("alert pertama membuat satu incident open", async () => {
    const result = await applyLibrenmsAlert(firing);
    expect(result.created).toBe(true);
    expect(result.state).toBe("open");
    expect(await countIncidents()).toBe(1);
  });

  it("alert berulang dengan ID sama memutakhirkan, bukan menduplikasi", async () => {
    const result = await applyLibrenmsAlert(firing);
    expect(result.created).toBe(false);
    expect(result.updated).toBe(true);
    expect(await countIncidents()).toBe(1);
  });

  it("perubahan severity/pesan ikut terekam pada baris yang sama", async () => {
    await applyLibrenmsAlert({
      ...firing,
      severity: "warning",
      message: "Device down (retry)",
    });
    const row = await firstIncident();
    expect(row.severity).toBe("warning");
    expect(row.message).toBe("Device down (retry)");
    expect(await countIncidents()).toBe(1);
  });

  it("recovery menutup (resolve) incident aktif", async () => {
    const result = await applyLibrenmsAlert({
      ...firing,
      state: "recovered",
      severity: "ok",
      message: "Device is up again",
    });
    expect(result.state).toBe("resolved");
    const row = await firstIncident();
    expect(row.state).toBe("resolved");
    expect(await countIncidents()).toBe(1);
  });

  it("recovery berulang tanpa incident aktif diabaikan (tidak membuat baris)", async () => {
    const result = await applyLibrenmsAlert({
      ...firing,
      state: "recovered",
      severity: "ok",
      message: "Device is up again",
    });
    expect(result.created).toBe(false);
    expect(result.updated).toBe(false);
    expect(await countIncidents()).toBe(1);
  });
});
