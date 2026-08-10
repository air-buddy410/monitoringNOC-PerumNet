import { NextResponse } from "next/server";
import { getAssetsWithStatus } from "@/server/device-store";
import {
  fetchDeviceGraphPng,
  LibrenmsError,
} from "@/server/librenms";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

const VALID_TYPES = new Set([
  "device_bits",
  "device_processor",
  "device_mempool",
  "device_uptime",
  "device_ping_perf",
]);

/**
 * GET /api/v1/assets/:assetId/graph?type=&from=&to=&width=&height=
 * Proksi grafik RRD LibreNMS sebagai PNG — token LibreNMS TIDAK pernah
 * dikirim ke browser (Fase 7). Default: trafik 24 jam terakhir.
 */
export const GET = withRole<{ params: Promise<{ assetId: string }> }>(
  [],
  async (request, _user, { params }) => {
    const { assetId } = await params;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") ?? "device_bits";
    if (!VALID_TYPES.has(type)) {
      return NextResponse.json(
        { error: `Jenis grafik tidak dikenal: ${type}` },
        { status: 400 },
      );
    }

    const from = searchParams.get("from") ?? "-24h";
    const to = searchParams.get("to") ?? undefined;
    const widthRaw = searchParams.get("width");
    const heightRaw = searchParams.get("height");
    const width = widthRaw ? Math.min(1600, Math.max(200, Number(widthRaw))) : 900;
    const height = heightRaw ? Math.min(800, Math.max(100, Number(heightRaw))) : 300;
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return NextResponse.json(
        { error: "width/height harus angka." },
        { status: 400 },
      );
    }

    const { assets } = await getAssetsWithStatus();
    const asset = assets.find((item) => item.assetId === assetId);
    if (!asset) {
      return NextResponse.json(
        { error: `Aset ${assetId} tidak ditemukan.` },
        { status: 404 },
      );
    }
    if (asset.librenmsDeviceId == null) {
      return NextResponse.json(
        {
          error:
            "Perangkat belum dipetakan ke LibreNMS — grafik RRD belum tersedia.",
        },
        { status: 404 },
      );
    }

    try {
      const png = await fetchDeviceGraphPng(asset.librenmsDeviceId, type, {
        from,
        to,
        width,
        height,
      });
      const body = png.buffer.slice(
        png.byteOffset,
        png.byteOffset + png.byteLength,
      ) as ArrayBuffer;
      return new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=30, stale-while-revalidate=30",
        },
      });
    } catch (error) {
      if (error instanceof LibrenmsError) {
        return NextResponse.json(
          { error: "LibreNMS tidak dapat menghasilkan grafik.", detail: error.status },
          { status: error.status === 404 ? 404 : 502 },
        );
      }
      throw error;
    }
  },
);
