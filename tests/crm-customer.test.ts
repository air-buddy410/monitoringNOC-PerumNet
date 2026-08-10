// Fase 6 — mapping CRM, isolasi portal customer (deep-link HMAC), dan webhook
// outbound. PGlite in-memory + migration SQL; HTTP di-mock penuh.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/db", () => ({ get db() { return mocks.db; } }));

import * as schema from "@/db/schema";
import {
  customerDeepLinkToken,
  getCustomerServiceStatus,
  sanitizeForCustomer,
  verifyCustomerDeepLink,
} from "@/server/customer-store";
import { notifyCrm } from "@/server/crm-webhook";
import {
  findServiceMapping,
  listServiceMappings,
  upsertServiceMapping,
} from "@/server/crm-store";
import { applyLibrenmsAlert, getIncidentById } from "@/server/incident-store";

const MIGRATION_DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const migrationSql = readdirSync(MIGRATION_DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(path.join(MIGRATION_DIR, file), "utf8"))
  .join("\n");

let client: PGlite;

/** Mock fetch: rute API v0 via map + endpoint CRM terpisah. */
function stubFetch(routes: Record<string, unknown>, crmResponse?: () => Response) {
  const mock = vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.startsWith("https://crm.example.test")) {
      return crmResponse?.() ?? {
        ok: true,
        status: 200,
        json: async () => ({ received: true }),
      } as unknown as Response;
    }
    const pathname = url.split("/api/v0")[1] ?? url;
    const hit = Object.entries(routes).find(([route]) => pathname === route);
    if (!hit) throw new Error(`route tidak ter-mock: ${pathname}`);
    return {
      ok: true,
      status: 200,
      json: async () => hit[1],
      arrayBuffer: async () => new Uint8Array().buffer,
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const ADMIN = "user-crm-admin";

beforeAll(async () => {
  client = new PGlite();
  await client.exec(migrationSql);
  mocks.db = drizzle(client, { schema });
  await client.query(
    'INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)',
    [ADMIN, "Admin CRM", "crm-admin@perumnet.id"],
  );
  // Aset layanan pelanggan (terpetakan ke device LibreNMS 10).
  await client.query(
    `INSERT INTO assets (asset_id, librenms_device_id, hostname, display_name, management_ip, vendor, site, network_role)
     VALUES ($1, 10, 'cust-core-1', 'Core Pelanggan', '10.9.0.1', 'MikroTik', 'Jakarta', 'core')`,
    ["asset-cust-1"],
  );
});

beforeEach(() => {
  vi.stubEnv("CUSTOMER_PORTAL_SECRET", "test-secret-123");
  vi.stubEnv("LIBRENMS_URL", "https://nms.example.test");
  vi.stubEnv("LIBRENMS_TOKEN", "tkn");
  vi.stubEnv("CUSTOMER_SUPPORT_CONTACT", "021-1234-5678");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("crm-store — mapping layanan", () => {
  it("upsert idempoten: buat lalu perbarui tanpa duplikasi", async () => {
    const created = await upsertServiceMapping({
      externalCustomerId: "cust-1",
      externalServiceId: "svc-1",
      assetId: "asset-cust-1",
      actorUserId: ADMIN,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.created).toBe(true);
    expect(created.mapping.syncStatus).toBe("active");
    expect(created.mapping.assetId).toBe("asset-cust-1");

    const updated = await upsertServiceMapping({
      externalCustomerId: "cust-1",
      externalServiceId: "svc-1",
      assetId: "asset-cust-1",
      actorUserId: ADMIN,
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.created).toBe(false);

    const count = await client.query<{ n: string }>(
      "SELECT count(*) AS n FROM crm_service_mappings WHERE external_customer_id = 'cust-1' AND external_service_id = 'svc-1'",
    );
    expect(Number(count.rows[0].n)).toBe(1);
  });

  it("menolak aset tak dikenal & ID kosong", async () => {
    const badAsset = await upsertServiceMapping({
      externalCustomerId: "cust-2",
      externalServiceId: "svc-2",
      assetId: "tidak-ada",
      actorUserId: ADMIN,
    });
    expect(badAsset.ok).toBe(false);

    const empty = await upsertServiceMapping({
      externalCustomerId: " ",
      externalServiceId: "svc-2",
      actorUserId: ADMIN,
    });
    expect(empty.ok).toBe(false);
  });

  it("list & find mapping", async () => {
    const list = await listServiceMappings();
    expect(list.some((m) => m.externalServiceId === "svc-1")).toBe(true);
    const found = await findServiceMapping("cust-1", "svc-1");
    expect(found?.assetId).toBe("asset-cust-1");
    expect(await findServiceMapping("cust-1", "svc-tidak-ada")).toBeNull();
  });
});

describe("portal customer — deep-link & isolasi", () => {
  it("token HMAC deterministik & verifikasi waktu konstan", () => {
    const a = customerDeepLinkToken("cust-1", "svc-1");
    const b = customerDeepLinkToken("cust-1", "svc-1");
    expect(a).toBe(b);
    expect(verifyCustomerDeepLink("cust-1", "svc-1", a)).toBe(true);
    expect(verifyCustomerDeepLink("cust-1", "svc-2", a)).toBe(false);
    expect(verifyCustomerDeepLink("cust-1", "svc-1", "garbage")).toBe(false);
  });

  it("menolak 400/401/404 tanpa membocorkan keberadaan layanan", async () => {
    stubFetch({
      "/devices?type=all": { devices: [] },
      "/alerts?state=1": { alerts: [] },
      "/alerts?state=2": { alerts: [] },
    });
    const token = customerDeepLinkToken("cust-1", "svc-1");

    const noParams = await getCustomerServiceStatus({
      customerId: "",
      serviceId: "svc-1",
      token: token,
    });
    expect(noParams.ok).toBe(false);
    if (!noParams.ok) expect(noParams.status).toBe(400);

    const badToken = await getCustomerServiceStatus({
      customerId: "cust-1",
      serviceId: "svc-1",
      token: "salah",
    });
    expect(badToken.ok).toBe(false);
    if (!badToken.ok) expect(badToken.status).toBe(401);

    const unknown = await getCustomerServiceStatus({
      customerId: "cust-1",
      serviceId: "svc-rahasia",
      token: customerDeepLinkToken("cust-1", "svc-rahasia"),
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.status).toBe(404);
  });

  it("response tidak membocorkan data internal (hostname/IP/manajemen)", async () => {
    stubFetch({
      "/devices?type=all": { devices: [] },
      "/alerts?state=1": { alerts: [] },
      "/alerts?state=2": { alerts: [] },
    });
    const result = await getCustomerServiceStatus({
      customerId: "cust-1",
      serviceId: "svc-1",
      token: customerDeepLinkToken("cust-1", "svc-1"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const raw = JSON.stringify(result.status);
    expect(raw).not.toContain("cust-core-1");
    expect(raw).not.toContain("10.9.0.1");
    expect(raw).not.toContain("MikroTik");
    expect(result.status.serviceId).toBe("svc-1");
    expect(result.status.supportContact).toBe("021-1234-5678");
  });

  it("incident aktif → degraded + message di-sanitasi; recovery → history", async () => {
    stubFetch({
      "/devices?type=all": { devices: [] },
      "/alerts?state=1": { alerts: [] },
      "/alerts?state=2": { alerts: [] },
    });

    await applyLibrenmsAlert({
      librenmsAlertId: "crm-alert-1",
      librenmsDeviceId: 10,
      deviceName: "cust-core-1",
      severity: "critical",
      state: "alerting",
      message: "Device down on cust-core-1",
      timestamp: "2026-08-10T09:00:00Z",
    });

    const active = await getCustomerServiceStatus({
      customerId: "cust-1",
      serviceId: "svc-1",
      token: customerDeepLinkToken("cust-1", "svc-1"),
    });
    expect(active.ok).toBe(true);
    if (!active.ok) return;
    expect(active.status.status).toBe("degraded");
    expect(active.status.activeIncident).not.toBeNull();
    expect(active.status.activeIncident?.message).toContain("Layanan terkait");
    expect(active.status.activeIncident?.message).not.toContain("cust-core-1");

    await applyLibrenmsAlert({
      librenmsAlertId: "crm-alert-1",
      librenmsDeviceId: 10,
      deviceName: "cust-core-1",
      severity: "ok",
      state: "recovered",
      message: "Device is up again",
      timestamp: "2026-08-10T10:30:00Z",
    });

    const resolved = await getCustomerServiceStatus({
      customerId: "cust-1",
      serviceId: "svc-1",
      token: customerDeepLinkToken("cust-1", "svc-1"),
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.status.activeIncident).toBeNull();
    expect(resolved.status.history.length).toBeGreaterThanOrEqual(1);
    expect(resolved.status.history[0].durationMinutes).toBeGreaterThanOrEqual(1);
  });
});

describe("sanitizeForCustomer", () => {
  it("menghapus nama perangkat internal dari pesan", () => {
    const cleaned = sanitizeForCustomer(
      "Device down on cust-core-1, ping timeout",
      "cust-core-1",
    );
    expect(cleaned).not.toContain("cust-core-1");
    expect(cleaned).toContain("Layanan terkait");
  });
});

describe("crm-webhook outbound", () => {
  const incidentForCrm = {
    id: "inc-crm-1",
    assetId: "asset-cust-1",
    deviceName: "cust-core-1",
    severity: "critical" as const,
    message: "Device down on cust-core-1",
    triggeredAt: new Date("2026-08-10T09:00:00Z"),
    recoveredAt: null,
  };

  it("tanpa CRM_WEBHOOK_URL → not-configured, tanpa fetch", async () => {
    stubFetch({ "/devices?type=all": { devices: [] } });
    const result = await notifyCrm(incidentForCrm, "open");
    expect(result.sent).toBe(false);
    expect(result.reason).toBe("not-configured");
  });

  it("dengan URL + mapping → terkirim, payload & header benar, audit sent", async () => {
    vi.stubEnv("CRM_WEBHOOK_URL", "https://crm.example.test/hooks/incidents");
    vi.stubEnv("CRM_WEBHOOK_TOKEN", "crm-secret");
    const mock = stubFetch({
      "/devices?type=all": { devices: [] },
      "/alerts?state=1": { alerts: [] },
      "/alerts?state=2": { alerts: [] },
    });

    const result = await notifyCrm(incidentForCrm, "open");
    expect(result.sent).toBe(true);

    const call = mock.mock.calls.find(([url]) =>
      String(url).startsWith("https://crm.example.test"),
    );
    expect(call).toBeDefined();
    const [url, init] = call as unknown as [string, RequestInit];
    expect(String(url)).toBe("https://crm.example.test/hooks/incidents");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer crm-secret");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.type).toBe("incident.open");
    expect(body.idempotencyKey).toBe("inc-crm-1:open");
    expect(body.externalCustomerId).toBe("cust-1");
    expect(body.externalServiceId).toBe("svc-1");
    expect(String(body.message)).not.toContain("cust-core-1");

    const audit = await client.query<{ n: string }>(
      "SELECT count(*) AS n FROM audit_logs WHERE action = 'crm_webhook.sent'",
    );
    expect(Number(audit.rows[0].n)).toBeGreaterThanOrEqual(1);
  });

  it("CRM error → retry lalu gagal, audit failed, tidak throw", async () => {
    vi.stubEnv("CRM_WEBHOOK_URL", "https://crm.example.test/hooks/incidents");
    const mock = stubFetch(
      {
        "/devices?type=all": { devices: [] },
        "/alerts?state=1": { alerts: [] },
        "/alerts?state=2": { alerts: [] },
      },
      () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response,
    );

    const result = await notifyCrm(incidentForCrm, "recovered");
    expect(result.sent).toBe(false);

    // 3 percobaan (1 + 2 retry)
    const attempts = mock.mock.calls.filter(([url]) =>
      String(url).startsWith("https://crm.example.test"),
    );
    expect(attempts.length).toBe(3);

    const audit = await client.query<{ n: string }>(
      "SELECT count(*) AS n FROM audit_logs WHERE action = 'crm_webhook.failed'",
    );
    expect(Number(audit.rows[0].n)).toBeGreaterThanOrEqual(1);
  });

  it("incident tanpa assetId / tanpa mapping → dilewati tanpa error", async () => {
    vi.stubEnv("CRM_WEBHOOK_URL", "https://crm.example.test/hooks/incidents");
    const noAsset = await notifyCrm(
      { ...incidentForCrm, assetId: null },
      "open",
    );
    expect(noAsset.sent).toBe(false);
    expect(noAsset.reason).toBe("no-asset-mapping");

    const noMapping = await notifyCrm(
      { ...incidentForCrm, assetId: "asset-tanpa-mapping" },
      "open",
    );
    expect(noMapping.sent).toBe(false);
    expect(noMapping.reason).toBe("no-crm-mapping");
  });

  it("getIncidentById dipakai webhook ingress → row terbaca", async () => {
    await applyLibrenmsAlert({
      librenmsAlertId: "crm-alert-2",
      librenmsDeviceId: 10,
      deviceName: "cust-core-1",
      severity: "warning",
      state: "alerting",
      message: "RX low on cust-core-1",
      timestamp: "2026-08-10T11:00:00Z",
    });
    const rows = await client.query<{ id: string }>(
      "SELECT id FROM incidents WHERE librenms_alert_id = 'crm-alert-2'",
    );
    const row = await getIncidentById(rows.rows[0].id);
    expect(row?.assetId).toBe("asset-cust-1");
  });
});
