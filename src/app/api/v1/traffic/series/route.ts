import { NextResponse } from "next/server";
import { withRole } from "@/server/rbac";
import { MAKS_JAM, bacaDeretTrafik } from "@/server/traffic-read";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/traffic/series?interfaceId=…&hours=24
 *
 * Titik yang tidak ada dikirim `null`, bukan 0 — nol berarti "trafik
 * berhenti", tidak ada berarti "kami tidak tahu".
 */
export const GET = withRole([], async (request) => {
  const { searchParams } = new URL(request.url);
  const interfaceId = searchParams.get("interfaceId")?.trim();
  if (!interfaceId) {
    return NextResponse.json(
      { error: "interfaceId wajib diisi." },
      { status: 400 },
    );
  }
  const hours = Number(searchParams.get("hours") ?? 24);
  if (!Number.isFinite(hours) || hours < 1 || hours > MAKS_JAM) {
    return NextResponse.json(
      { error: `hours harus 1–${MAKS_JAM}.` },
      { status: 400 },
    );
  }
  const deret = await bacaDeretTrafik(interfaceId, hours);
  if (!deret) {
    return NextResponse.json({ error: "Interface tidak ditemukan." }, { status: 404 });
  }
  return NextResponse.json(deret, { headers: { "Cache-Control": "no-store" } });
});
