import { NextResponse } from "next/server";
import { withRole } from "@/server/rbac";
import { petaFiber } from "@/server/fiber-geo";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/ftth/geo — simpul dan garis jalur fiber untuk peta.
 *
 * Letak kabel DITURUNKAN dari tempat core-nya menempel; tidak ada kolom
 * geometri di database. Kabel yang kedua ujungnya tidak diketahui **tidak
 * digambar** — ia masuk `tanpaGeometri` beserta alasannya.
 *
 * Garis tebakan di peta jaringan dipakai orang untuk memutuskan ke mana
 * berangkat saat kabel putus. Peta yang jujur mengaku tidak tahu jauh lebih
 * berguna daripada peta yang lengkap.
 */
export const GET = withRole([], async () => {
  const peta = await petaFiber();
  return NextResponse.json(peta, { headers: { "Cache-Control": "no-store" } });
});
