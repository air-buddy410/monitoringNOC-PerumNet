import { NextResponse } from "next/server";
import { withRole } from "@/server/rbac";
import { buatOtb, daftarOtb } from "@/server/otb-store";
import type { BuatOtbInput } from "@/server/otb-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/ftth/otb — pengisi dropdown "Pilih OTB".
 *
 * `trayCount`, `portCount`, dan `usedPorts` semuanya DITURUNKAN dari baris
 * tray/port, bukan kolom tersimpan — supaya tidak pernah ada dua angka yang
 * bisa berbeda tentang hal yang sama.
 */
export const GET = withRole([], async () => {
  const rows = await daftarOtb();
  return NextResponse.json(
    { otb: rows },
    { headers: { "Cache-Control": "no-store" } },
  );
});

/** POST — membuat OTB beserta seluruh tray dan port-nya dalam satu transaksi. */
export const POST = withRole(["admin", "noc"], async (request, user) => {
  let body: BuatOtbInput;
  try {
    body = (await request.json()) as BuatOtbInput;
  } catch {
    return NextResponse.json(
      { error: "Body harus JSON yang valid." },
      { status: 400 },
    );
  }

  if (body.connectorType && !["SC", "LC"].includes(body.connectorType)) {
    return NextResponse.json(
      { error: "connectorType harus SC atau LC." },
      { status: 400 },
    );
  }
  if (body.polish && !["UPC", "APC"].includes(body.polish)) {
    return NextResponse.json(
      { error: "polish harus UPC atau APC." },
      { status: 400 },
    );
  }

  const hasil = await buatOtb(body, user.id);
  if (!hasil.ok) {
    return NextResponse.json({ error: hasil.error }, { status: hasil.status });
  }
  return NextResponse.json(hasil.data, { status: 201 });
});
