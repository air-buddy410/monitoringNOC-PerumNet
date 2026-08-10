// Store topologi jaringan (Fase 5) — sumber desain operasional Portal.
//
// Prinsip sesuai PRD:
// - Topologi manual adalah otoritas desain; discovery LibreNMS hanya
//   menghasilkan REKOMENDASI (suggestion) yang harus direview & dikonfirmasi.
// - Link tidak pernah menyimpan kredensial; hanya metadata link.
// - Publish membuat snapshot versi (topology_versions) — operasional stabil,
//   draft tidak pernah menimpa versi yang sudah dipublikasikan.
// - Semua perubahan yang mengubah keadaan dicatat ke audit_logs.

import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLogs,
  topologies,
  topologyDiscoverySuggestions,
  topologyLinks,
  topologyNodes,
  topologyVersions,
} from "@/db/schema";
import type {
  TopologyDetailResponse,
  TopologyDiscoverySuggestion,
  TopologyLink,
  TopologyNode,
  TopologyPatchAction,
  TopologySummary,
} from "@/server/api-v1/contracts";
import { getAssetsWithStatus } from "@/server/device-store";
import { fetchDeviceLinks, normalizeDiscoveredLink } from "@/server/librenms";

// ---------------------------------------------------------------------------
// Konversi baris → kontrak
// ---------------------------------------------------------------------------

function toSummary(row: typeof topologies.$inferSelect): TopologySummary {
  return {
    topologyId: row.id,
    name: row.name,
    status: row.status,
    version: row.currentVersion,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toNode(row: typeof topologyNodes.$inferSelect): TopologyNode {
  return {
    nodeId: row.id,
    assetId: row.assetId,
    x: row.x,
    y: row.y,
    label: row.label,
  };
}

function toLink(row: typeof topologyLinks.$inferSelect): TopologyLink {
  return {
    linkId: row.id,
    sourceNodeId: row.sourceNodeId,
    targetNodeId: row.targetNodeId,
    sourcePort: row.sourcePort,
    targetPort: row.targetPort,
    mediaType: row.mediaType,
    capacityMbps: row.capacityMbps,
    direction: row.direction,
    status: row.status,
    note: row.note,
  };
}

function toSuggestion(
  row: typeof topologyDiscoverySuggestions.$inferSelect,
): TopologyDiscoverySuggestion {
  return {
    suggestionId: row.id,
    kind: row.kind,
    source: row.source,
    confidence: row.confidence,
    discoveredAt: row.discoveredAt.toISOString(),
    payload: row.payload,
    state: row.state,
  };
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

async function writeAudit(
  executor: typeof db,
  action: string,
  topologyId: string,
  actorUserId: string | null,
  detail?: Record<string, unknown>,
) {
  await executor.insert(auditLogs).values({
    id: randomUUID(),
    actorUserId,
    actorLabel: actorUserId ? "user" : "system",
    action,
    entityType: "topology",
    entityId: topologyId,
    detail,
    createdAt: new Date(),
  });
}

// ---------------------------------------------------------------------------
// Baca
// ---------------------------------------------------------------------------

export async function listTopologies(): Promise<TopologySummary[]> {
  const rows = await db
    .select()
    .from(topologies)
    .orderBy(desc(topologies.updatedAt));
  return rows.map(toSummary);
}

export async function getTopologyDetail(
  topologyId: string,
): Promise<TopologyDetailResponse | null> {
  const [row] = await db
    .select()
    .from(topologies)
    .where(eq(topologies.id, topologyId))
    .limit(1);
  if (!row) return null;

  const [nodes, links] = await Promise.all([
    db
      .select()
      .from(topologyNodes)
      .where(eq(topologyNodes.topologyId, topologyId))
      .orderBy(sql`${topologyNodes.createdAt} asc`),
    db
      .select()
      .from(topologyLinks)
      .where(eq(topologyLinks.topologyId, topologyId)),
  ]);

  return {
    topology: toSummary(row),
    nodes: nodes.map(toNode),
    links: links.map(toLink),
  };
}

export async function listSuggestions(
  topologyId: string,
): Promise<TopologyDiscoverySuggestion[]> {
  const rows = await db
    .select()
    .from(topologyDiscoverySuggestions)
    .where(eq(topologyDiscoverySuggestions.topologyId, topologyId))
    .orderBy(desc(topologyDiscoverySuggestions.discoveredAt));
  return rows.map(toSuggestion);
}

// ---------------------------------------------------------------------------
// Tulis: buat, ubah, publish
// ---------------------------------------------------------------------------

export async function createTopology(input: {
  name: string;
  userId: string;
}): Promise<TopologyDetailResponse> {
  const id = randomUUID();
  await db.insert(topologies).values({
    id,
    name: input.name.trim(),
    createdBy: input.userId,
  });
  await writeAudit(db, "topology.created", id, input.userId, { name: input.name.trim() });
  const detail = await getTopologyDetail(id);
  if (!detail) throw new Error("Topologi baru gagal dibaca.");
  return detail;
}

export async function renameTopology(
  topologyId: string,
  name: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: topologies.id })
    .from(topologies)
    .where(eq(topologies.id, topologyId))
    .limit(1);
  if (!row) return false;
  await db
    .update(topologies)
    .set({ name: name.trim(), updatedAt: new Date() })
    .where(eq(topologies.id, topologyId));
  await writeAudit(db, "topology.renamed", topologyId, userId, { name: name.trim() });
  return true;
}

// --- Edit manual (node & link) ---------------------------------------------

const NODE_GRID_STEP = 220;

// Tipe koneksi transaksi Drizzle — dipakai untuk memastikan semua query pada
// transaksi memakai `tx` (PGlite single-connection: mencampur db global di
// dalam transaksi menyebabkan deadlock menunggu koneksi yang sama).
type TxExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Posisi node baru otomatis bila tidak diberikan — grid berjarak rapi. */
async function autoPosition(
  topologyId: string,
  executor: TxExecutor,
): Promise<{ x: number; y: number }> {
  const [{ n } = { n: 0 }] = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(topologyNodes)
    .where(eq(topologyNodes.topologyId, topologyId));
  const count = n ?? 0;
  return {
    x: 80 + (count % 5) * NODE_GRID_STEP,
    y: 80 + Math.floor(count / 5) * 160,
  };
}

function validateLink(link: {
  sourceNodeId: string;
  targetNodeId: string;
}) {
  if (!link.sourceNodeId || !link.targetNodeId) {
    return "sourceNodeId dan targetNodeId wajib diisi.";
  }
  if (link.sourceNodeId === link.targetNodeId) {
    return "Link tidak boleh menghubungkan node ke dirinya sendiri.";
  }
  return null;
}

async function applyPatchAction(
  topologyId: string,
  action: TopologyPatchAction,
  userId: string,
  executor: TxExecutor,
): Promise<string | null> {
  switch (action.op) {
    case "addNode": {
      const { x, y } = action.node.x != null && action.node.y != null
        ? { x: action.node.x, y: action.node.y }
        : await autoPosition(topologyId, executor);
      try {
        await executor.insert(topologyNodes).values({
          id: randomUUID(),
          topologyId,
          assetId: action.node.assetId,
          x,
          y,
          label: action.node.label ?? null,
        });
      } catch {
        return "Aset tidak dikenal atau sudah menjadi node.";
      }
      await writeAudit(executor, "topology.node_added", topologyId, userId, {
        assetId: action.node.assetId,
      });
      return null;
    }

    case "moveNode": {
      if (action.x == null || action.y == null) return "x dan y wajib diisi.";
      const [row] = await executor
        .select({ id: topologyNodes.id })
        .from(topologyNodes)
        .where(
          and(
            eq(topologyNodes.id, action.nodeId),
            eq(topologyNodes.topologyId, topologyId),
          ),
        )
        .limit(1);
      if (!row) return "Node tidak ditemukan.";
      await executor
        .update(topologyNodes)
        .set({ x: action.x, y: action.y, updatedAt: new Date() })
        .where(eq(topologyNodes.id, action.nodeId));
      return null;
    }

    case "removeNode": {
      // Link yang menempel terhapus otomatis (FK onDelete cascade).
      await executor
        .delete(topologyNodes)
        .where(
          and(
            eq(topologyNodes.id, action.nodeId),
            eq(topologyNodes.topologyId, topologyId),
          ),
        );
      await writeAudit(executor, "topology.node_removed", topologyId, userId, {
        nodeId: action.nodeId,
      });
      return null;
    }

    case "addLink": {
      const invalid = validateLink(action.link);
      if (invalid) return invalid;
      const [duplicate] = await executor
        .select({ id: topologyLinks.id })
        .from(topologyLinks)
        .where(
          and(
            eq(topologyLinks.topologyId, topologyId),
            eq(topologyLinks.sourceNodeId, action.link.sourceNodeId),
            eq(topologyLinks.targetNodeId, action.link.targetNodeId),
          ),
        )
        .limit(1);
      if (duplicate) return "Link antara kedua node sudah ada.";
      try {
        await executor.insert(topologyLinks).values({
          id: randomUUID(),
          topologyId,
          ...action.link,
          direction: action.link.direction ?? "bi",
          status: action.link.status ?? "unknown",
        });
      } catch {
        return "Salah satu node tidak ditemukan.";
      }
      await writeAudit(executor, "topology.link_added", topologyId, userId, {
        sourceNodeId: action.link.sourceNodeId,
        targetNodeId: action.link.targetNodeId,
      });
      return null;
    }

    case "updateLink": {
      const [row] = await executor
        .select({ id: topologyLinks.id })
        .from(topologyLinks)
        .where(
          and(
            eq(topologyLinks.id, action.linkId),
            eq(topologyLinks.topologyId, topologyId),
          ),
        )
        .limit(1);
      if (!row) return "Link tidak ditemukan.";
      await executor
        .update(topologyLinks)
        .set({
          sourcePort: action.sourcePort ?? undefined,
          targetPort: action.targetPort ?? undefined,
          mediaType: action.mediaType ?? undefined,
          capacityMbps: action.capacityMbps ?? undefined,
          direction: action.direction ?? undefined,
          status: action.status ?? undefined,
          note: action.note ?? undefined,
          updatedAt: new Date(),
        })
        .where(eq(topologyLinks.id, action.linkId));
      return null;
    }

    case "removeLink": {
      await executor
        .delete(topologyLinks)
        .where(
          and(
            eq(topologyLinks.id, action.linkId),
            eq(topologyLinks.topologyId, topologyId),
          ),
        );
      await writeAudit(executor, "topology.link_removed", topologyId, userId, {
        linkId: action.linkId,
      });
      return null;
    }

    default:
      return `Operasi tidak dikenal: ${(action as { op: string }).op}`;
  }
}

export type PatchResult =
  | { ok: true; detail: TopologyDetailResponse }
  | { ok: false; error: string };

/** Terapkan daftar aksi edit manual secara berurutan (transaksi). */
export async function patchTopology(input: {
  topologyId: string;
  userId: string;
  name?: string;
  actions?: TopologyPatchAction[];
}): Promise<PatchResult> {
  const existing = await getTopologyDetail(input.topologyId);
  if (!existing) return { ok: false, error: "Topologi tidak ditemukan." };

  try {
    await db.transaction(async (tx) => {
      if (input.name) {
        await tx
          .update(topologies)
          .set({ name: input.name.trim(), updatedAt: new Date() })
          .where(eq(topologies.id, input.topologyId));
      }
      for (const action of input.actions ?? []) {
        const error = await applyPatchAction(
          input.topologyId,
          action,
          input.userId,
          tx,
        );
        if (error) throw new Error(error);
      }
      if ((input.actions?.length ?? 0) > 0) {
        await writeAudit(tx, "topology.edited", input.topologyId, input.userId, {
          actions: input.actions?.length,
        });
      }
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const detail = await getTopologyDetail(input.topologyId);
  return { ok: true, detail: detail ?? existing };
}

// --- Publish (snapshot versi) ----------------------------------------------

export type PublishResult =
  | { ok: true; topology: TopologySummary }
  | { ok: false; error: string };

export async function publishTopology(
  topologyId: string,
  userId: string,
): Promise<PublishResult> {
  const detail = await getTopologyDetail(topologyId);
  if (!detail) return { ok: false, error: "Topologi tidak ditemukan." };

  const version = detail.topology.version + 1;

  await db.transaction(async (tx) => {
    await tx.insert(topologyVersions).values({
      id: randomUUID(),
      topologyId,
      version,
      snapshot: { nodes: detail.nodes, links: detail.links },
      publishedBy: userId,
      publishedAt: new Date(),
    });
    await tx
      .update(topologies)
      .set({
        status: "published",
        currentVersion: version,
        updatedAt: new Date(),
      })
      .where(eq(topologies.id, topologyId));
  });

  await writeAudit(db, "topology.published", topologyId, userId, { version });
  const [row] = await db
    .select()
    .from(topologies)
    .where(eq(topologies.id, topologyId))
    .limit(1);
  return { ok: true, topology: toSummary(row) };
}

// ---------------------------------------------------------------------------
// Discovery LibreNMS → rekomendasi (tidak pernah menimpa manual)
// ---------------------------------------------------------------------------

export interface DiscoveryRunResult {
  discovered: number;
  suggested: number;
  failedDevices: number;
  ranAt: string;
}

/** Payload jsonb mungkin dibaca sebagai objek (Postgres) atau string (PGlite). */
function normalizePayload(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return (value as Record<string, unknown>) ?? {};
}

/**
 * Signature JSON yang kebal terhadap urutan kunci (Postgres jsonb tidak
 * menjamin urutan kunci saat dikembalikan) — dipakai untuk deduplikasi.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return JSON.stringify(value.map(canonicalize));
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return JSON.stringify(keys.map((key) => [key, canonicalize(record[key])]));
}

/** Cegah duplikat usulan pending: kunci (kind + payload canonical). */
async function isSuggestionDuplicate(
  topologyId: string,
  kind: "node" | "link",
  payload: Record<string, unknown>,
): Promise<boolean> {
  const signature = canonicalize(payload);
  const rows = await db
    .select({ payload: topologyDiscoverySuggestions.payload })
    .from(topologyDiscoverySuggestions)
    .where(
      and(
        eq(topologyDiscoverySuggestions.topologyId, topologyId),
        eq(topologyDiscoverySuggestions.kind, kind),
        eq(topologyDiscoverySuggestions.state, "pending"),
      ),
    );
  return rows.some(
    (row) => canonicalize(normalizePayload(row.payload)) === signature,
  );
}

async function insertSuggestion(
  topologyId: string,
  kind: "node" | "link",
  source: TopologyDiscoverySuggestion["source"],
  confidence: TopologyDiscoverySuggestion["confidence"],
  payload: Record<string, unknown>,
): Promise<boolean> {
  if (await isSuggestionDuplicate(topologyId, kind, payload)) return false;
  await db.insert(topologyDiscoverySuggestions).values({
    id: randomUUID(),
    topologyId,
    kind,
    source,
    confidence,
    payload,
    state: "pending",
    discoveredAt: new Date(),
  });
  return true;
}

/**
 * Jalankan discovery dari relasi/neighbor LibreNMS untuk topologi.
 * Hasil berupa usulan (pending) — tidak mengubah node/link yang ada.
 * Device tanpa pemetaan aset dilewati; kegagalan HTTP per device tidak
 * menggagalkan keseluruhan run (dihitung pada failedDevices).
 */
export async function runDiscovery(
  topologyId: string,
): Promise<DiscoveryRunResult> {
  const detail = await getTopologyDetail(topologyId);
  if (!detail) throw new Error("Topologi tidak ditemukan.");

  const { assets } = await getAssetsWithStatus();
  const byDeviceId = new Map<number, string>();
  for (const asset of assets) {
    if (asset.librenmsDeviceId != null) {
      byDeviceId.set(asset.librenmsDeviceId, asset.assetId);
    }
  }

  const existingNodes = new Set(detail.nodes.map((node) => node.assetId));
  const existingLinkPairs = new Set(
    detail.links.map((link) => `${link.sourceNodeId}|${link.targetNodeId}`),
  );
  const nodeIdByAssetId = new Map(
    detail.nodes.map((node) => [node.assetId, node.nodeId]),
  );

  let suggested = 0;
  let discovered = 0;
  let failedDevices = 0;

  // Usulan node: aset terpetakan yang belum menjadi node.
  for (const asset of assets) {
    if (asset.librenmsDeviceId != null && !existingNodes.has(asset.assetId)) {
      const added = await insertSuggestion(
        topologyId,
        "node",
        "device-relation",
        "medium",
        {
          assetId: asset.assetId,
          librenmsDeviceId: asset.librenmsDeviceId,
          displayName: asset.displayName,
          networkRole: asset.networkRole,
        },
      );
      if (added) suggested += 1;
    }
  }

  // Usulan link: neighbor discovery antar aset yang sudah jadi node.
  for (const [deviceId, assetId] of byDeviceId) {
    if (!existingNodes.has(assetId)) continue;
    let links;
    try {
      links = await fetchDeviceLinks(deviceId);
    } catch {
      failedDevices += 1;
      continue;
    }
    for (const rawLink of links) {
      const link = normalizeDiscoveredLink(rawLink);
      if (!link) continue;
      const remoteAssetId = byDeviceId.get(link.remoteDeviceId);
      if (!remoteAssetId || remoteAssetId === assetId) continue;
      discovered += 1;
      const sourceNodeId = nodeIdByAssetId.get(assetId);
      const targetNodeId = nodeIdByAssetId.get(remoteAssetId);
      if (!sourceNodeId || !targetNodeId) continue;
      const pair = `${sourceNodeId}|${targetNodeId}`;
      if (existingLinkPairs.has(pair) || existingLinkPairs.has(`${targetNodeId}|${sourceNodeId}`)) {
        continue;
      }
      const added = await insertSuggestion(
        topologyId,
        "link",
        link.protocol === "lldp" || link.protocol === "cdp" ? "lldp" : "device-relation",
        link.protocol === "lldp" || link.protocol === "cdp" ? "high" : "medium",
        {
          sourceAssetId: assetId,
          targetAssetId: remoteAssetId,
          sourceDeviceId: deviceId,
          targetDeviceId: link.remoteDeviceId,
          localPortId: link.localPortId,
          remotePort: link.remotePort,
          protocol: link.protocol,
        },
      );
      if (added) suggested += 1;
    }
  }

  return { discovered, suggested, failedDevices, ranAt: new Date().toISOString() };
}

export type ReviewResult =
  | { ok: true; suggestion: TopologyDiscoverySuggestion }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Tinjau usulan discovery. `accepted` untuk usulan link/node langsung
 * digabungkan ke topologi (idempoten); `rejected` menutup usulan tanpa
 * efek lain. Selalu dicatat ke audit.
 */
export async function reviewSuggestion(input: {
  topologyId: string;
  suggestionId: string;
  state: "accepted" | "rejected";
  userId: string;
}): Promise<ReviewResult> {
  const [row] = await db
    .select()
    .from(topologyDiscoverySuggestions)
    .where(
      and(
        eq(topologyDiscoverySuggestions.id, input.suggestionId),
        eq(topologyDiscoverySuggestions.topologyId, input.topologyId),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, status: 404, error: "Usulan tidak ditemukan." };
  if (row.state !== "pending") {
    return { ok: false, status: 409, error: "Usulan sudah ditinjau." };
  }

  await db
    .update(topologyDiscoverySuggestions)
    .set({
      state: input.state,
      reviewedBy: input.userId,
      reviewedAt: new Date(),
    })
    .where(eq(topologyDiscoverySuggestions.id, input.suggestionId));

  if (input.state === "accepted") {
    const payload = row.payload as Record<string, string | number | null>;
    if (row.kind === "link") {
      const detail = await getTopologyDetail(input.topologyId);
      if (detail) {
        const source = detail.nodes.find((n) => n.assetId === payload.sourceAssetId);
        const target = detail.nodes.find((n) => n.assetId === payload.targetAssetId);
        if (source && target && source.nodeId !== target.nodeId) {
          const patch = await patchTopology({
            topologyId: input.topologyId,
            userId: input.userId,
            actions: [
              {
                op: "addLink",
                link: {
                  sourceNodeId: source.nodeId,
                  targetNodeId: target.nodeId,
                  sourcePort: payload.localPortId != null ? String(payload.localPortId) : null,
                  targetPort: payload.remotePort != null ? String(payload.remotePort) : null,
                  mediaType: payload.protocol != null ? String(payload.protocol) : null,
                  direction: "bi",
                  status: "unknown",
                },
              },
            ],
          });
          if (!patch.ok && patch.error.includes("sudah ada")) {
            await db
              .update(topologyDiscoverySuggestions)
              .set({ state: "rejected" })
              .where(eq(topologyDiscoverySuggestions.id, input.suggestionId));
          }
        }
      }
    } else {
      // kind = node: tambah node (posisi otomatis).
      await patchTopology({
        topologyId: input.topologyId,
        userId: input.userId,
        actions: [
          {
            op: "addNode",
            node: {
              assetId: String(payload.assetId),
              x: null,
              y: null,
              label: null,
            },
          },
        ],
      });
    }
  }

  await writeAudit(db, "topology.suggestion_reviewed", input.topologyId, input.userId, {
    suggestionId: input.suggestionId,
    kind: row.kind,
    state: input.state,
  });

  const [updated] = await db
    .select()
    .from(topologyDiscoverySuggestions)
    .where(eq(topologyDiscoverySuggestions.id, input.suggestionId))
    .limit(1);
  return { ok: true, suggestion: toSuggestion(updated) };
}
