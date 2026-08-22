import { NextResponse } from "next/server";
import { withRole } from "@/server/rbac";
import { buatKabel, daftarKabel } from "@/server/fiber-store";
import type { BuatKabelInput } from "@/server/fiber-store";

export const dynamic = "force-dynamic";

const KATEGORI = ["backbone", "feeder", "distribution", "dropcore", "interconnect", "lain"];
const SERAT = ["G.652D", "G.657A1", "G.657A2", "lain"];

/** GET /api/v1/ftth/cables — daftar kabel dengan hitungan core turunan. */
export const GET = withRole([], async () => {
  const cables = await daftarKabel();
  return NextResponse.json({ cables }, { headers: { "Cache-Control": "no-store" } });
});

/** POST — membuat kabel beserta seluruh core-nya dalam satu transaksi. */
export const POST = withRole(["admin", "noc"], async (request, user) => {
  let body: BuatKabelInput;
  try {
    body = (await request.json()) as BuatKabelInput;
  } catch {
    return NextResponse.json({ error: "Body harus JSON yang valid." }, { status: 400 });
  }

  if (!KATEGORI.includes(body.category)) {
    return NextResponse.json(
      { error: `category harus salah satu dari: ${KATEGORI.join(", ")}.` },
      { status: 400 },
    );
  }
  if (body.fiberType && !SERAT.includes(body.fiberType)) {
    return NextResponse.json(
      { error: `fiberType harus salah satu dari: ${SERAT.join(", ")}.` },
      { status: 400 },
    );
  }
  if (
    body.tubeSize !== undefined &&
    body.tubeSize !== null &&
    !Number.isInteger(body.tubeSize)
  ) {
    return NextResponse.json(
      { error: "tubeSize harus bilangan bulat, atau dikosongkan untuk kabel tanpa tabung." },
      { status: 400 },
    );
  }
  if (body.purpose && body.purpose !== "feeder" && body.purpose !== "distribution") {
    return NextResponse.json(
      { error: "purpose harus feeder atau distribution." },
      { status: 400 },
    );
  }

  const hasil = await buatKabel(body, user.id);
  if (!hasil.ok) {
    return NextResponse.json({ error: hasil.error }, { status: hasil.status });
  }
  return NextResponse.json(hasil.data, { status: 201 });
});
