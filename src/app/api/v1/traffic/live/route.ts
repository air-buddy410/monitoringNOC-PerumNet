import { NextResponse } from "next/server";
import { withRole } from "@/server/rbac";
import { bacaTrafikLive } from "@/server/traffic-read";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/traffic/live
 *
 * Laju terakhir tiap interface yang dipantau, plus total uplink.
 *
 * Dibaca dari `traffic_samples`, TIDAK dari router. Router hanya dihubungi
 * worker — kalau jalur permintaan ikut menghubunginya, satu router yang
 * lambat menahan pemuatan halaman dan sepuluh penonton layar TV jadi sepuluh
 * panggilan ke perangkat produksi.
 *
 * `ageSeconds` dan `stale` selalu ikut: layar yang membeku terlihat persis
 * seperti jaringan yang tenang, dan itu kegagalan paling berbahaya di sini.
 */
export const GET = withRole([], async () => {
  return NextResponse.json(await bacaTrafikLive(), {
    headers: { "Cache-Control": "no-store" },
  });
});
