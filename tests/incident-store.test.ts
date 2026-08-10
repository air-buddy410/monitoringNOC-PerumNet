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
import {
  acknowledgeIncident,
  applyLibrenmsAlert,
  listIncidents,
} from "@/server/incident-store";
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
  await client.query(
    'INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)',
    ["user-test-1", "Test NOC", "test-noc@perumnet.id"],
  );
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

describe("listIncidents & acknowledgeIncident", () => {
  const ackAlert: NormalizedLibrenmsAlert = {
    librenmsAlertId: "alert-ack-1",
    librenmsDeviceId: 2,
    deviceName: "olt-tebet-01",
    severity: "warning",
    state: "alerting",
    message: "RX power low",
    timestamp: "2026-08-10T08:00:00Z",
  };

  it("ack incident aktif → acknowledged + note + actor", async () => {
    const created = await applyLibrenmsAlert(ackAlert);
    expect(created.created).toBe(true);

    const result = await acknowledgeIncident({
      ref: ackAlert.librenmsAlertId,
      acknowledgedBy: "user-test-1",
      note: "  sedang dicek tim lapangan  ",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.incident.state).toBe("acknowledged");
    expect(result.incident.acknowledgedBy).toBe("user-test-1");
    expect(result.incident.acknowledgedAt).not.toBeNull();
    expect(result.incident.resolutionNote).toBe("sedang dicek tim lapangan");
  });

  it("ack dengan ID internal incident juga diterima", async () => {
    const [row] = (
      await client.query<{ id: string }>(
        "SELECT id FROM incidents WHERE librenms_alert_id = $1",
        [ackAlert.librenmsAlertId],
      )
    ).rows;
    const result = await acknowledgeIncident({
      ref: row.id,
      acknowledgedBy: "user-test-1",
    });
    expect(result.ok).toBe(true);
  });

  it("ack incident tak dikenal → 404", async () => {
    const result = await acknowledgeIncident({
      ref: "alert-tidak-ada",
      acknowledgedBy: "user-test-1",
    });
    expect(result).toEqual({
      ok: false,
      status: 404,
      error: "Incident alert-tidak-ada tidak ditemukan.",
    });
  });

  it("ack incident yang sudah resolved → 409", async () => {
    await applyLibrenmsAlert({
      ...ackAlert,
      state: "recovered",
      severity: "ok",
      message: "RX power normal",
    });
    const result = await acknowledgeIncident({
      ref: ackAlert.librenmsAlertId,
      acknowledgedBy: "user-test-1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
  });

  it("listIncidents membaca dari tabel + filter state/severity", async () => {
    const all = await listIncidents({ limit: 10 });
    expect(all.total).toBeGreaterThanOrEqual(2);

    const resolved = await listIncidents({ state: "resolved" });
    expect(resolved.incidents.every((item) => item.state === "resolved")).toBe(true);

    const critical = await listIncidents({ severity: "critical" });
    expect(critical.incidents.every((item) => item.severity === "critical")).toBe(true);
  });

  it("acknowledge menulis audit trail (incident.acknowledged)", async () => {
    const result = await client.query<{ n: string }>(
      "SELECT count(*) AS n FROM audit_logs WHERE action = 'incident.acknowledged'",
    );
    expect(Number(result.rows[0].n)).toBeGreaterThanOrEqual(2);
  });
});
