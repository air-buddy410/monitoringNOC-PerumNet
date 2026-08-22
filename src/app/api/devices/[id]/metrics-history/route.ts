import { NextResponse } from "next/server";
import type { HistoryMetric } from "@/lib/mock-metrics";
import { cache } from "@/server/cache";
import { getLatestDevices } from "@/server/device-store";
import { riwayatMetrik, type HasilRiwayat } from "@/server/metrics-history";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

const VALID_METRICS: HistoryMetric[] = ["cpu", "ram", "suhu", "bandwidth"];
const MAX_HOURS = 24 * 30; // maksimal 30 hari ke belakang
const HISTORY_TTL_SECONDS = 60;

type HistorySnapshot = HasilRiwayat & { updatedAt: string };

/**
 * GET /api/devices/:id/metrics-history?metric=<cpu|ram|suhu|bandwidth>&hours=<n>
 *
 * Deret historis satu metrik untuk rentang `hours` terakhir (default 24).
 *
 * **`sumber` WAJIB dibaca:** `terukur` berarti angkanya dari pengukuran,
 * `fixture` berarti deret tiruan pengembangan, `belum-ada-data` berarti
 * portal ini memang belum menyimpan riwayat metrik itu. Sampai 22 Agustus
 * 2026 endpoint ini selalu mengarang angkanya tanpa mengatakannya.
 *
 * `points[].value` boleh `null` — itu jeda pengukuran, bukan nol.
 */
export const GET = withRole<{ params: Promise<{ id: string }> }>(
  [],
  async (request, _user, { params }) => {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const metric = (searchParams.get("metric") ?? "cpu") as HistoryMetric;
    const hoursRaw = searchParams.get("hours") ?? "24";
    const hours = Number(hoursRaw);

    if (!VALID_METRICS.includes(metric)) {
      return NextResponse.json(
        { error: `Metrik tidak dikenal: ${metric}` },
        { status: 400 },
      );
    }
    if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_HOURS) {
      return NextResponse.json(
        { error: `Rentang jam tidak valid: ${hoursRaw} (1–${MAX_HOURS})` },
        { status: 400 },
      );
    }

    const snapshot = await getLatestDevices();
    const device = snapshot.devices.find((item) => item.id === id);
    if (!device) {
      return NextResponse.json(
        { error: `Perangkat dengan ID ${id} tidak ditemukan.` },
        { status: 404 },
      );
    }

    const key = `metrics-history:${id}:${metric}:${hours}`;
    let history = await cache.get<HistorySnapshot>(key);
    if (!history) {
      // Hostname diambil sendiri oleh store dari `assets` — proyeksi
      // `NetworkDevice` di sini memuat `display_name`, bukan hostname.
      const hasil = await riwayatMetrik({ assetId: id, metric, hours });
      history = { ...hasil, updatedAt: new Date().toISOString() };
      await cache.set(key, history, HISTORY_TTL_SECONDS);
    }

    return NextResponse.json(history, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
      },
    });
  },
);
