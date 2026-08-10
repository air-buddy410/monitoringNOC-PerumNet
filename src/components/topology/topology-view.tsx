"use client";

// Halaman Topologi Jaringan (Fase 5) — mode Lihat / Edit Manual / Review
// Discovery. Data dari /api/v1/topologies*; semua perubahan lewat PATCH
// (admin/engineer). Discovery LibreNMS hanya menghasilkan rekomendasi.

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  GitFork,
  Layers,
  Loader2,
  MousePointer2,
  Network,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Unlink,
  X,
} from "lucide-react";
import type {
  TopologyDetailResponse,
  TopologyDiscoverySuggestion,
  TopologyNode,
  TopologySummary,
} from "@/server/api-v1/contracts";
import type { Asset } from "@/types/asset";

type Mode = "view" | "edit" | "review";

interface DetailPayload {
  detail: TopologyDetailResponse;
}

const fetcher = (url: string) => fetch(url).then((r) => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
});

const statusColor: Record<string, string> = {
  online: "#22c55e",
  warning: "#f59e0b",
  offline: "#ef4444",
};

export default function TopologyView() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: listData, error: listError, mutate: reloadList } = useSWR<{
    topologies: TopologySummary[];
  }>("/api/v1/topologies", fetcher);

  const topologies = useMemo(() => listData?.topologies ?? [], [listData]);

  // Topologi aktif: pilihan eksplisit user, atau yang terbaru sebagai default.
  const effectiveId = selectedId ?? topologies[0]?.topologyId ?? null;

  const { data: detailData, error: detailError, isLoading: detailLoading, mutate: reloadDetail } =
    useSWR<DetailPayload>(
      effectiveId ? `/api/v1/topologies/${effectiveId}` : null,
      fetcher,
    );

  const { data: suggestionData, mutate: reloadSuggestions } = useSWR<{
    suggestions: TopologyDiscoverySuggestion[];
  }>(effectiveId ? `/api/v1/topologies/${effectiveId}/discovery` : null, fetcher);

  const detail = detailData?.detail;

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 4000);
  }

  async function createTopology() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const response = await fetch("/api/v1/topologies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload: DetailPayload = await response.json();
      setSelectedId(payload.detail.topology.topologyId);
      setNewName("");
      setMode("edit");
      flash("Topologi dibuat.");
      await reloadList();
    } catch {
      flash("Gagal membuat topologi.");
    } finally {
      setCreating(false);
    }
  }

  async function patchTopology(actions: unknown[], extra?: { name?: string }) {
    if (!effectiveId) return false;
    try {
      const response = await fetch(`/api/v1/topologies/${effectiveId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actions, ...extra }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        flash(body?.error ?? "Perubahan ditolak.");
        return false;
      }
      await reloadDetail();
      await reloadList();
      return true;
    } catch {
      flash("Gagal menyimpan perubahan.");
      return false;
    }
  }

  async function runDiscovery() {
    if (!effectiveId) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/topologies/${effectiveId}/discovery`, {
        method: "POST",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        flash(body?.error ?? "Discovery gagal.");
      } else {
        flash(
          `Discovery: ${body.discovered} link ditemukan, ${body.suggested} usulan baru${body.failedDevices ? `, ${body.failedDevices} device gagal dibaca` : ""}.`,
        );
        await reloadSuggestions();
      }
    } catch {
      flash("Gagal menjalankan discovery.");
    } finally {
      setBusy(false);
    }
  }

  async function reviewSuggestion(suggestionId: string, state: "accepted" | "rejected") {
    if (!effectiveId) return;
    try {
      const response = await fetch(
        `/api/v1/topologies/${effectiveId}/discovery/${suggestionId}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        flash(body?.error ?? "Review gagal.");
        return;
      }
      flash(state === "accepted" ? "Usulan diterima & digabungkan." : "Usulan ditolak.");
      await reloadSuggestions();
      await reloadDetail();
    } catch {
      flash("Gagal menyimpan review.");
    }
  }

  async function publishTopology() {
    if (!effectiveId) return;
    if (!window.confirm("Publikasikan versi baru topologi ini?")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/topologies/${effectiveId}/publish`, {
        method: "POST",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        flash(body?.error ?? "Publish gagal.");
      } else {
        flash(`Versi ${body.topology.version} dipublikasikan.`);
        await reloadDetail();
        await reloadList();
      }
    } catch {
      flash("Gagal publish.");
    } finally {
      setBusy(false);
    }
  }

  if (listError) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-red-600">
        {listError.message.includes("403")
          ? "Akses ditolak — topologi hanya untuk admin, NOC, dan engineer."
          : "Gagal memuat topologi."}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {notice && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {notice}
        </div>
      )}

      {/* Toolbar utama */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && createTopology()}
            placeholder="Nama topologi baru…"
            className="w-44 bg-transparent text-sm outline-none"
            disabled={creating}
          />
          <button
            type="button"
            onClick={createTopology}
            disabled={creating || !newName.trim()}
            className="flex items-center gap-1 text-sm font-medium text-sky-700 disabled:opacity-40"
          >
            <Plus size={16} aria-hidden="true" /> Buat
          </button>
        </div>

        <div className="flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          {(
            [
              ["view", "Lihat", MousePointer2],
              ["edit", "Edit Manual", GitFork],
              ["review", "Review Discovery", Layers],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${
                mode === value
                  ? "bg-sky-600 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Icon size={15} aria-hidden="true" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {detail && mode === "review" && (
          <button
            type="button"
            onClick={runDiscovery}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
          >
            <RefreshCw size={15} aria-hidden="true" className={busy ? "animate-spin" : ""} />
            Jalankan Discovery
          </button>
        )}

        {detail && mode !== "review" && (
          <button
            type="button"
            onClick={publishTopology}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            <Send size={15} aria-hidden="true" /> Publish v{detail.topology.version + 1}
          </button>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-[240px_1fr]">
        {/* Daftar topologi */}
        <aside className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Topologi ({topologies.length})
          </h2>
          <ul className="max-h-72 divide-y divide-slate-50 overflow-y-auto lg:max-h-[65vh]">
            {topologies.length === 0 && (
              <li className="px-3 py-4 text-sm text-slate-400">
                Belum ada topologi — buat yang pertama di atas.
              </li>
            )}
            {topologies.map((item) => (
              <li key={item.topologyId}>
                <button
                  type="button"
                  onClick={() => setSelectedId(item.topologyId)}
                  className={`w-full px-3 py-2 text-left ${
                    effectiveId === item.topologyId ? "bg-sky-50" : "hover:bg-slate-50"
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                    <Network size={14} aria-hidden="true" className="text-slate-400" />
                    {item.name}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        item.status === "published"
                          ? "bg-emerald-500/15 text-emerald-600"
                          : "bg-amber-500/15 text-amber-600"
                      }`}
                    >
                      {item.status}
                    </span>
                    v{item.version}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Kanvas & panel */}
        <section className="flex flex-col gap-3">
          {detailLoading && (
            <div className="flex h-64 items-center justify-center text-sm text-slate-400">
              <Loader2 className="mr-2 animate-spin" size={16} /> Memuat diagram…
            </div>
          )}
          {detailError && !detailLoading && (
            <div className="flex h-64 items-center justify-center text-sm text-red-600">
              Gagal memuat topologi.
            </div>
          )}
          {detail && !detailLoading && (
            <TopologyCanvas
              detail={detail}
              mode={mode}
              onPatch={patchTopology}
            />
          )}

          {detail && mode === "review" && (
            <SuggestionPanel
              suggestions={suggestionData?.suggestions ?? []}
              onReview={reviewSuggestion}
              busy={busy}
            />
          )}
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kanvas SVG
// ---------------------------------------------------------------------------

const CANVAS_W = 1200;
const CANVAS_H = 800;

function TopologyCanvas({
  detail,
  mode,
  onPatch,
}: {
  detail: DetailPayload["detail"];
  mode: Mode;
  onPatch: (actions: unknown[]) => Promise<boolean>;
}) {
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [dragNode, setDragNode] = useState<{ id: string; x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<{ site: string; role: string; status: string }>({
    site: "",
    role: "",
    status: "",
  });
  const svgRef = useRef<SVGSVGElement>(null);

  const { data: assetsData } = useSWR<{ assets: Asset[] }>("/api/v1/assets", fetcher);
  const assets = useMemo(() => assetsData?.assets ?? [], [assetsData]);
  const assetById = useMemo(
    () => new Map(assets.map((asset) => [asset.assetId, asset])),
    [assets],
  );

  const sites = useMemo(
    () => [...new Set(assets.map((asset) => asset.site))].sort(),
    [assets],
  );
  const roles = useMemo(
    () => [...new Set(assets.map((asset) => asset.networkRole))].sort(),
    [assets],
  );

  const nodes = detail.nodes;
  const links = detail.links;
  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.nodeId, node])),
    [nodes],
  );

  function matchesFilter(node: TopologyNode): boolean {
    const asset = assetById.get(node.assetId);
    if (!asset) return true;
    const q = query.trim().toLowerCase();
    if (q && !`${asset.displayName} ${asset.hostname} ${asset.managementIp}`.toLowerCase().includes(q)) {
      return false;
    }
    if (filter.site && asset.site !== filter.site) return false;
    if (filter.role && asset.networkRole !== filter.role) return false;
    if (filter.status && asset.status !== filter.status) return false;
    return true;
  }

  function commitMove(nodeId: string, x: number, y: number) {
    onPatch([{ op: "moveNode", nodeId, x, y }]);
  }

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (mode !== "edit") {
      setPanning(true);
      setPanStart({ x: event.clientX, y: event.clientY });
      return;
    }
    setPanning(true);
    setPanStart({ x: event.clientX, y: event.clientY });
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (dragNode) {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sx = (event.clientX - rect.left - view.x) / view.scale;
      const sy = (event.clientY - rect.top - view.y) / view.scale;
      setDragNode({ ...dragNode, x: sx, y: sy });
      return;
    }
    if (panning && panStart) {
      setView((v) => ({
        ...v,
        x: v.x + (event.clientX - panStart.x),
        y: v.y + (event.clientY - panStart.y),
      }));
      setPanStart({ x: event.clientX, y: event.clientY });
    }
  }

  function handlePointerUp() {
    if (dragNode) {
      commitMove(dragNode.id, dragNode.x, dragNode.y);
    }
    setDragNode(null);
    setPanning(false);
    setPanStart(null);
  }

  function handleWheel(event: React.WheelEvent<SVGSVGElement>) {
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    setView((v) => ({
      ...v,
      scale: Math.min(2.5, Math.max(0.3, v.scale * factor)),
    }));
  }

  function clickNode(node: TopologyNode) {
    if (mode !== "edit") {
      setSelectedNode(node.nodeId);
      setSelectedLink(null);
      return;
    }
    if (linkFrom) {
      if (linkFrom !== node.nodeId) {
        onPatch([
          { op: "addLink", link: { sourceNodeId: linkFrom, targetNodeId: node.nodeId } },
        ]);
      }
      setLinkFrom(null);
      return;
    }
    setSelectedNode(node.nodeId);
    setSelectedLink(null);
  }

  function startLink(nodeId: string) {
    setLinkFrom(nodeId);
    setSelectedNode(null);
  }

  function removeSelected() {
    if (!selectedNode) return;
    onPatch([{ op: "removeNode", nodeId: selectedNode }]);
    setSelectedNode(null);
    setSelectedLink(null);
  }

  function removeSelectedLink() {
    if (!selectedLink) return;
    onPatch([{ op: "removeLink", linkId: selectedLink }]);
    setSelectedLink(null);
  }

  function resetView() {
    setView({ x: 0, y: 0, scale: 1 });
  }

  const visibleNodes = nodes.filter(matchesFilter);
  const visibleIds = new Set(visibleNodes.map((node) => node.nodeId));

  return (
    <div className="flex flex-col gap-2">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cari nama, hostname, IP…"
          className="w-44 bg-transparent text-sm outline-none"
        />
        <select
          value={filter.site}
          onChange={(event) => setFilter((f) => ({ ...f, site: event.target.value }))}
          className="text-sm text-slate-600 outline-none"
        >
          <option value="">Semua site</option>
          {sites.map((site) => (
            <option key={site} value={site}>{site}</option>
          ))}
        </select>
        <select
          value={filter.role}
          onChange={(event) => setFilter((f) => ({ ...f, role: event.target.value }))}
          className="text-sm text-slate-600 outline-none"
        >
          <option value="">Semua role</option>
          {roles.map((role) => (
            <option key={role} value={role}>{role}</option>
          ))}
        </select>
        <select
          value={filter.status}
          onChange={(event) => setFilter((f) => ({ ...f, status: event.target.value }))}
          className="text-sm text-slate-600 outline-none"
        >
          <option value="">Semua status</option>
          <option value="online">Online</option>
          <option value="warning">Warning</option>
          <option value="offline">Offline</option>
        </select>
        <button
          type="button"
          onClick={resetView}
          className="ml-auto text-xs text-slate-400 hover:text-slate-600"
        >
          Atur ulang tampilan
        </button>
      </div>

      <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 shadow-sm">
        <svg
          ref={svgRef}
          width="100%"
          height={CANVAS_H / 1.6}
          viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
          className="cursor-grab touch-none select-none active:cursor-grabbing"
          style={{ touchAction: "none" }}
        >
          <g transform={`translate(${view.x}, ${view.y}) scale(${view.scale})`}>
            {links.map((link) => {
              const source = nodeById.get(link.sourceNodeId);
              const target = nodeById.get(link.targetNodeId);
              if (!source || !target) return null;
              const dim = !visibleIds.has(source.nodeId) || !visibleIds.has(target.nodeId);
              const isSelected = selectedLink === link.linkId;
              return (
                <g
                  key={link.linkId}
                  onClick={() => {
                    setSelectedLink(link.linkId);
                    setSelectedNode(null);
                  }}
                  className={dim ? "opacity-15" : ""}
                >
                  <line
                    x1={source.x} y1={source.y} x2={target.x} y2={target.y}
                    stroke={isSelected ? "#0ea5e9" : "#94a3b8"}
                    strokeWidth={isSelected ? 3 : 2}
                    strokeDasharray={link.status === "down" ? "6 4" : undefined}
                  />
                  {link.sourcePort && (
                    <text
                      x={(source.x + target.x) / 2}
                      y={(source.y + target.y) / 2 - 6}
                      textAnchor="middle"
                      fontSize={10}
                      fill="#64748b"
                    >
                      {link.sourcePort}
                      {link.targetPort ? ` ⇄ ${link.targetPort}` : ""}
                    </text>
                  )}
                </g>
              );
            })}

            {nodes.map((node) => {
              const asset = assetById.get(node.assetId);
              const dim = !matchesFilter(node);
              const position = dragNode?.id === node.nodeId ? dragNode : node;
              const color = asset ? statusColor[asset.status] ?? "#94a3b8" : "#94a3b8";
              const isSelected = selectedNode === node.nodeId;
              const isLinkSource = linkFrom === node.nodeId;
              return (
                <g
                  key={node.nodeId}
                  transform={`translate(${position.x}, ${position.y})`}
                  onClick={(event) => {
                    event.stopPropagation();
                    clickNode(node);
                  }}
                  onPointerDown={(event) => {
                    if (mode !== "edit") return;
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setDragNode({ id: node.nodeId, x: position.x, y: position.y });
                  }}
                  className={`${dim ? "opacity-15" : ""} ${mode === "edit" ? "cursor-move" : "cursor-pointer"}`}
                >
                  <circle r={26} fill={color} opacity={0.15} />
                  <circle r={16} fill="#fff" stroke={color} strokeWidth={3} />
                  {isLinkSource && <circle r={22} fill="none" stroke="#0ea5e9" strokeWidth={2} strokeDasharray="3 3" />}
                  <text
                    textAnchor="middle"
                    dy={-30}
                    fontSize={12}
                    fontWeight={isSelected ? 700 : 600}
                    fill="#0f172a"
                  >
                    {node.label ?? asset?.displayName ?? node.assetId}
                  </text>
                  <text textAnchor="middle" dy={-17} fontSize={9} fill="#64748b">
                    {asset ? `${asset.hostname} · ${asset.networkRole}` : node.assetId}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* Panel aksi edit */}
        {mode === "edit" && (
          <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-md">
            <span className="text-xs text-slate-400">Edit:</span>
            <button
              type="button"
              onClick={() => setLinkFrom(null)}
              className={`rounded px-2 py-1 text-xs ${linkFrom ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              Buat link (klik node pertama)
            </button>
            <button
              type="button"
              onClick={removeSelected}
              disabled={!selectedNode}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-red-600 disabled:opacity-40"
            >
              <Trash2 size={12} aria-hidden="true" /> Hapus node
            </button>
            <button
              type="button"
              onClick={removeSelectedLink}
              disabled={!selectedLink}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-red-600 disabled:opacity-40"
            >
              <Unlink size={12} aria-hidden="true" /> Hapus link
            </button>
            <span className="text-xs text-slate-400">(seret node untuk memindah)</span>
          </div>
        )}

        {/* Detail node */}
        {selectedNode && (
          <div className="absolute right-3 top-3 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-md">
            {(() => {
              const node = nodeById.get(selectedNode);
              const asset = node ? assetById.get(node.assetId) : null;
              if (!node || !asset) return null;
              return (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{asset.displayName}</p>
                      <p className="text-xs text-slate-400">{asset.hostname}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedNode(null)}
                      aria-label="Tutup"
                      className="text-slate-400 hover:text-slate-600"
                    >
                      <X size={15} aria-hidden="true" />
                    </button>
                  </div>
                  <dl className="mt-2 space-y-1 text-xs">
                    <div className="flex justify-between"><dt className="text-slate-400">IP</dt><dd>{asset.managementIp}</dd></div>
                    <div className="flex justify-between"><dt className="text-slate-400">Vendor</dt><dd>{asset.vendor}</dd></div>
                    <div className="flex justify-between"><dt className="text-slate-400">Model</dt><dd>{asset.model ?? "—"}</dd></div>
                    <div className="flex justify-between"><dt className="text-slate-400">Site</dt><dd>{asset.site}</dd></div>
                    <div className="flex items-center justify-between">
                      <dt className="text-slate-400">Status</dt>
                      <dd className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full" style={{ background: statusColor[asset.status] ?? "#94a3b8" }} />
                        {asset.status}
                      </dd>
                    </div>
                  </dl>
                  <Link
                    href={`/devices/${node.assetId}`}
                    className="mt-3 block rounded bg-slate-800 px-3 py-1.5 text-center text-xs font-medium text-white hover:bg-slate-700"
                  >
                    Buka detail perangkat
                  </Link>
                  {mode === "edit" && (
                    <button
                      type="button"
                      onClick={() => startLink(node.nodeId)}
                      className="mt-2 block w-full rounded border border-slate-200 px-3 py-1.5 text-center text-xs text-slate-600 hover:bg-slate-50"
                    >
                      Buat link dari node ini
                    </button>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel review discovery
// ---------------------------------------------------------------------------

function SuggestionPanel({
  suggestions,
  onReview,
  busy,
}: {
  suggestions: TopologyDiscoverySuggestion[];
  onReview: (id: string, state: "accepted" | "rejected") => void;
  busy: boolean;
}) {
  const pending = suggestions.filter((item) => item.state === "pending");
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Usulan discovery ({pending.length} menunggu)
        </h2>
        <span className="text-xs text-slate-400">sumber: relasi/LLDP/CDP LibreNMS</span>
      </div>
      {pending.length === 0 && (
        <p className="px-3 py-4 text-sm text-slate-400">
          Tidak ada usulan menunggu — jalankan discovery untuk menarik relasi dari LibreNMS.
        </p>
      )}
      <ul className="divide-y divide-slate-50">
        {pending.map((suggestion) => (
          <li key={suggestion.suggestionId} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                suggestion.kind === "node" ? "bg-sky-500/15 text-sky-600" : "bg-emerald-500/15 text-emerald-600"
              }`}
            >
              {suggestion.kind}
            </span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
              {suggestion.source} · {suggestion.confidence}
            </span>
            <span className="min-w-0 flex-1 text-sm text-slate-700">
              {suggestion.kind === "node"
                ? `Tambah node: ${String(suggestion.payload.displayName ?? suggestion.payload.assetId)}`
                : `Link: ${String(suggestion.payload.sourceAssetId)} ⇄ ${String(suggestion.payload.targetAssetId)}${
                    suggestion.payload.remotePort ? ` (port ${suggestion.payload.remotePort})` : ""
                  }`}
            </span>
            <span className="flex gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => onReview(suggestion.suggestionId, "accepted")}
                className="rounded bg-emerald-600 px-2.5 py-1 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                Terima
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onReview(suggestion.suggestionId, "rejected")}
                className="rounded bg-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-300 disabled:opacity-50"
              >
                Tolak
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
