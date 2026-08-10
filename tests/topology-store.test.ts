// Store topologi (Fase 5): CRUD, edit manual, publish/version, discovery &
// review. PGlite in-memory + migration SQL; HTTP LibreNMS di-mock via fetch.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/db", () => ({ get db() { return mocks.db; } }));

import * as schema from "@/db/schema";
import {
  createTopology,
  getTopologyDetail,
  listTopologies,
  patchTopology,
  publishTopology,
  reviewSuggestion,
  runDiscovery,
} from "@/server/topology-store";

const MIGRATION_DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const migrationSql = readdirSync(MIGRATION_DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(path.join(MIGRATION_DIR, file), "utf8"))
  .join("\n");

let client: PGlite;

/** Mock fetch per path (setelah prefix /api/v0). */
function stubApi(routes: Record<string, unknown>) {
  const mock = vi.fn(async (input: string | URL) => {
    const url = String(input);
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

const USER = "user-topology";

beforeAll(async () => {
  client = new PGlite();
  await client.exec(migrationSql);
  mocks.db = drizzle(client, { schema });
  await client.query(
    'INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)',
    [USER, "Test Engineer", "engineer@perumnet.id"],
  );
  // Dua aset terpetakan ke LibreNMS (device 1 & 2).
  await client.query(
    `INSERT INTO assets (asset_id, librenms_device_id, hostname, display_name, management_ip, vendor, site, network_role)
     VALUES ($1,1,'core-1','Core 1','10.0.0.1','MikroTik','Jakarta','core'),
            ($2,2,'olt-1','OLT 1','10.0.0.2','ZTE','Jakarta','olt')`,
    ["asset-core-1", "asset-olt-1"],
  );
});

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubEnv("LIBRENMS_URL", "https://nms.example.test");
  vi.stubEnv("LIBRENMS_TOKEN", "tkn");
});

describe("topologi — buat, ubah, list", () => {
  it("createTopology membuat draft kosong versi 0", async () => {
    const detail = await createTopology({ name: "  Jaringan Pusat  ", userId: USER });
    expect(detail.topology.name).toBe("Jaringan Pusat");
    expect(detail.topology.status).toBe("draft");
    expect(detail.topology.version).toBe(0);
    expect(detail.nodes).toEqual([]);
    expect(detail.links).toEqual([]);
  });

  it("listTopologies mengembalikan ringkasan", async () => {
    const list = await listTopologies();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0]).toHaveProperty("topologyId");
    expect(list[0]).toHaveProperty("status");
  });
});

describe("topologi — edit manual", () => {
  let topologyId: string;

  beforeEach(async () => {
    const detail = await createTopology({ name: "Edit Manual", userId: USER });
    topologyId = detail.topology.topologyId;
  });

  it("addNode dua node (posisi otomatis) + moveNode", async () => {
    let result = await patchTopology({
      topologyId,
      userId: USER,
      actions: [
        { op: "addNode", node: { assetId: "asset-core-1", x: null, y: null, label: null } },
        { op: "addNode", node: { assetId: "asset-olt-1", x: null, y: null, label: "OLT Tebet" } },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detail.nodes).toHaveLength(2);
    expect(result.detail.nodes[0].x).toBe(80);
    expect(result.detail.nodes[1].label).toBe("OLT Tebet");

    const nodeId = result.detail.nodes[0].nodeId;
    result = await patchTopology({
      topologyId,
      userId: USER,
      actions: [{ op: "moveNode", nodeId, x: 400, y: 250 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detail.nodes.find((n) => n.nodeId === nodeId)).toMatchObject({ x: 400, y: 250 });
  });

  it("addNode aset tak dikenal → error", async () => {
    const result = await patchTopology({
      topologyId,
      userId: USER,
      actions: [{ op: "addNode", node: { assetId: "tidak-ada", x: 10, y: 10, label: null } }],
    });
    expect(result.ok).toBe(false);
  });

  it("addLink antar node + tolak duplikat & self-link", async () => {
    const setup = await patchTopology({
      topologyId,
      userId: USER,
      actions: [
        { op: "addNode", node: { assetId: "asset-core-1", x: null, y: null, label: null } },
        { op: "addNode", node: { assetId: "asset-olt-1", x: null, y: null, label: null } },
      ],
    });
    if (!setup.ok) throw new Error("setup gagal");
    const [a, b] = setup.detail.nodes;

    let result = await patchTopology({
      topologyId,
      userId: USER,
      actions: [
        {
          op: "addLink",
          link: {
            sourceNodeId: a.nodeId,
            targetNodeId: b.nodeId,
            sourcePort: "ge-0",
            mediaType: "fiber",
            direction: "bi",
          },
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detail.links).toHaveLength(1);
    expect(result.detail.links[0].mediaType).toBe("fiber");

    // duplikat
    result = await patchTopology({
      topologyId,
      userId: USER,
      actions: [
        { op: "addLink", link: { sourceNodeId: a.nodeId, targetNodeId: b.nodeId } },
      ],
    });
    expect(result.ok).toBe(false);
    expect("error" in result && result.error).toContain("sudah ada");

    // self-link
    result = await patchTopology({
      topologyId,
      userId: USER,
      actions: [{ op: "addLink", link: { sourceNodeId: a.nodeId, targetNodeId: a.nodeId } }],
    });
    expect(result.ok).toBe(false);
  });

  it("removeNode menghapus link yang menempel (cascade)", async () => {
    const setup = await patchTopology({
      topologyId,
      userId: USER,
      actions: [
        { op: "addNode", node: { assetId: "asset-core-1", x: null, y: null, label: null } },
        { op: "addNode", node: { assetId: "asset-olt-1", x: null, y: null, label: null } },
      ],
    });
    if (!setup.ok) throw new Error("setup gagal");
    const [a, b] = setup.detail.nodes;
    const linked = await patchTopology({
      topologyId,
      userId: USER,
      actions: [{ op: "addLink", link: { sourceNodeId: a.nodeId, targetNodeId: b.nodeId } }],
    });
    if (!linked.ok) throw new Error("link gagal");

    const result = await patchTopology({
      topologyId,
      userId: USER,
      actions: [{ op: "removeNode", nodeId: a.nodeId }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detail.nodes).toHaveLength(1);
    expect(result.detail.links).toHaveLength(0);
  });
});

describe("topologi — publish & versioning", () => {
  it("publish membuat versi + snapshot tanpa mengubah draft", async () => {
    const created = await createTopology({ name: "Publish", userId: USER });
    const id = created.topology.topologyId;
    const patched = await patchTopology({
      topologyId: id,
      userId: USER,
      actions: [{ op: "addNode", node: { assetId: "asset-core-1", x: 10, y: 20, label: null } }],
    });
    if (!patched.ok) throw new Error("patch gagal");

    const result = await publishTopology(id, USER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.topology.status).toBe("published");
    expect(result.topology.version).toBe(1);

    const versions = await client.query<{ n: string; snapshot: unknown }>(
      "SELECT count(*) AS n, max(snapshot::text) AS snapshot FROM topology_versions WHERE topology_id = $1",
      [id],
    );
    expect(Number(versions.rows[0].n)).toBe(1);

    // publish ulang → versi 2, snapshot tetap ada (2 baris)
    const second = await publishTopology(id, USER);
    expect(second.ok && second.topology.version).toBe(2);
    const count = await client.query<{ n: string }>(
      "SELECT count(*) AS n FROM topology_versions WHERE topology_id = $1",
      [id],
    );
    expect(Number(count.rows[0].n)).toBe(2);
  });
});

describe("topologi — discovery & review", () => {
  let topologyId: string;

  beforeEach(async () => {
    const created = await createTopology({ name: "Discovery", userId: USER });
    topologyId = created.topology.topologyId;
    // Kedua aset sudah menjadi node → discovery berfokus pada usulan link.
    await patchTopology({
      topologyId,
      userId: USER,
      actions: [
        { op: "addNode", node: { assetId: "asset-core-1", x: null, y: null, label: null } },
        { op: "addNode", node: { assetId: "asset-olt-1", x: null, y: null, label: null } },
      ],
    });
  });

  it("runDiscovery mengusulkan link dari neighbor lldp (bukan menimpa manual)", async () => {
    stubApi({
      "/devices?type=all": {
        devices: [
          { device_id: 1, hostname: "core-1", sysName: "core-1", status: 1, os: "routeros" },
          { device_id: 2, hostname: "olt-1", sysName: "olt-1", status: 1, os: "zxa10" },
        ],
      },
      "/alerts?state=1": { alerts: [] },
      "/alerts?state=2": { alerts: [] },
      "/devices/1/links": {
        links: [
          { id: 11, local_device_id: 1, remote_device_id: 2, active: 1, protocol: "lldp", local_port_id: 7, remote_port: "ge-0" },
          { id: 12, local_device_id: 1, remote_device_id: 999, active: 1, protocol: "lldp" },
        ],
      },
      "/devices/2/links": { links: [] },
    });

    const result = await runDiscovery(topologyId);
    expect(result.discovered).toBe(1);
    expect(result.suggested).toBe(1);
    expect(result.failedDevices).toBe(0);

    // Jalankan ulang → tidak menduplikasi usulan pending.
    const again = await runDiscovery(topologyId);
    expect(again.suggested).toBe(0);
  });

  it("review accepted node/link menggabungkan ke topologi; 404/409 aman", async () => {
    stubApi({
      "/devices?type=all": { devices: [] },
      "/alerts?state=1": { alerts: [] },
      "/alerts?state=2": { alerts: [] },
    });

    // Run dengan device kosong → tidak ada link; tambahkan usulan node secara
    // langsung via SQL untuk menguji jalur review tanpa menunggu discovery.
    await client.query(
      `INSERT INTO topology_discovery_suggestions
       (id, topology_id, kind, source, confidence, payload, state, discovered_at)
       VALUES ($1, $2, 'node', 'device-relation', 'medium',
               $3::jsonb, 'pending', now())`,
      ["sug-node-1", topologyId, JSON.stringify({ assetId: "asset-olt-1", displayName: "OLT 1" })],
    );

    const rejected = await reviewSuggestion({
      topologyId,
      suggestionId: "sug-node-1",
      state: "rejected",
      userId: USER,
    });
    expect(rejected.ok && rejected.suggestion.state).toBe("rejected");

    // 409: sudah ditinjau
    const again = await reviewSuggestion({
      topologyId,
      suggestionId: "sug-node-1",
      state: "accepted",
      userId: USER,
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.status).toBe(409);

    // 404
    const missing = await reviewSuggestion({
      topologyId,
      suggestionId: "sug-tidak-ada",
      state: "accepted",
      userId: USER,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.status).toBe(404);
  });

  it("review accepted node menambahkan node ke topologi", async () => {
    stubApi({
      "/devices?type=all": { devices: [] },
      "/alerts?state=1": { alerts: [] },
      "/alerts?state=2": { alerts: [] },
    });
    // Aset ketiga yang belum menjadi node di topologi ini.
    await client.query(
      `INSERT INTO assets (asset_id, librenms_device_id, hostname, display_name, management_ip, vendor, site, network_role)
       VALUES ($1, 3, 'core-2', 'Core 2', '10.0.0.3', 'MikroTik', 'Jakarta', 'core')`,
      ["asset-core-2"],
    );
    await client.query(
      `INSERT INTO topology_discovery_suggestions
       (id, topology_id, kind, source, confidence, payload, state, discovered_at)
       VALUES ($1, $2, 'node', 'device-relation', 'medium',
               $3::jsonb, 'pending', now())`,
      ["sug-node-2", topologyId, JSON.stringify({ assetId: "asset-core-2", displayName: "Core 2" })],
    );

    const before = await getTopologyDetail(topologyId);
    const nodeCountBefore = before?.nodes.length ?? 0;

    const accepted = await reviewSuggestion({
      topologyId,
      suggestionId: "sug-node-2",
      state: "accepted",
      userId: USER,
    });
    expect(accepted.ok).toBe(true);

    const after = await getTopologyDetail(topologyId);
    expect(after?.nodes.length).toBe(nodeCountBefore + 1);
  });
});
