import { NextResponse } from "next/server";
import { ringkasPadam } from "@/server/outage";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/outages
 *
 * Gangguan yang MENGGEROMBOL, bertingkat: situs → OLT → ODP. Yang lebih
 * tinggi menelan yang lebih rendah, supaya satu situs padam tidak muncul
 * sebagai 40 alarm ODP yang mengubur satu-satunya baris berguna.
 *
 * `padamTersebar` sengaja dilaporkan terpisah dan TIDAK dijadikan alarm: itu
 * pelanggan padam sendiri-sendiri, hampir selalu modem yang dicabut. Angkanya
 * berguna sebagai latar ("15 tersebar" itu hari normal), tapi mendatanginya
 * satu per satu bukan pekerjaan siapa pun.
 *
 * Dihitung saat dibaca, tidak disimpan — supaya tidak pernah ada dua angka
 * yang bisa berbeda tentang gangguan yang sama.
 */
export const GET = withRole([], async () => {
  const ringkasan = await ringkasPadam();
  return NextResponse.json(ringkasan, {
    headers: { "Cache-Control": "no-store" },
  });
});
