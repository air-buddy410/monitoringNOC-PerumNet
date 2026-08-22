import { NextResponse } from "next/server";
import { withRole } from "@/server/rbac";
import { JENIS_TOPOLOGI, MAKS_BARIS, riwayatTopologi } from "@/server/riwayat-store";
import type { JenisEntitas } from "@/server/riwayat-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/ftth/riwayat — riwayat perubahan topologi.
 *
 *   ?jenis=otb&id=<otbId>   riwayat satu entitas BESERTA yang menempel padanya
 *   ?limit=30               1–100
 *   ?sesudah=<penanda>      halaman berikutnya, dari `berikutnya` jawaban lalu
 *
 * Tanpa `jenis`/`id`, ia mengembalikan riwayat seluruh topologi.
 *
 * Ruang lingkupnya sengaja dikembangkan: riwayat sebuah OTB mencakup tray dan
 * portnya, karena yang dicari orang saat gangguan adalah "apa yang pernah
 * terjadi pada rak ini" — bukan hanya peristiwa pada barisnya sendiri.
 */
export const GET = withRole([], async (request) => {
  const p = new URL(request.url).searchParams;
  const jenis = p.get("jenis");
  const id = p.get("id");

  if (jenis && !JENIS_TOPOLOGI.includes(jenis as JenisEntitas)) {
    return NextResponse.json(
      { error: `jenis harus salah satu dari: ${JENIS_TOPOLOGI.join(", ")}.` },
      { status: 400 },
    );
  }
  if ((jenis && !id) || (id && !jenis)) {
    return NextResponse.json(
      { error: "jenis dan id harus dikirim bersama." },
      { status: 400 },
    );
  }

  const limitMentah = p.get("limit");
  if (limitMentah !== null) {
    const n = Number(limitMentah);
    if (!Number.isInteger(n) || n < 1 || n > MAKS_BARIS) {
      return NextResponse.json(
        { error: `limit harus 1–${MAKS_BARIS}.` },
        { status: 400 },
      );
    }
  }

  const hasil = await riwayatTopologi({
    jenis: (jenis as JenisEntitas | null) ?? undefined,
    id: id ?? undefined,
    limit: limitMentah ? Number(limitMentah) : undefined,
    sesudah: p.get("sesudah"),
  });
  return NextResponse.json(hasil, { headers: { "Cache-Control": "no-store" } });
});
