import { NextResponse } from "next/server";
import { withRole } from "@/server/rbac";
import { daftarPortTray, ubahPort } from "@/server/otb-store";
import type { UbahPortInput } from "@/server/otb-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ otbId: string; trayNumber: string }> };

function nomorTray(mentah: string): number | null {
  const n = Number(mentah);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** GET — isi tab "Inventori Tray". */
export const GET = withRole([], async (_request, _user, ctx: Ctx) => {
  const { otbId, trayNumber } = await ctx.params;
  const nomor = nomorTray(trayNumber);
  if (nomor === null) {
    return NextResponse.json(
      { error: "Nomor tray harus bilangan bulat positif." },
      { status: 400 },
    );
  }

  const ports = await daftarPortTray(otbId, nomor);
  if (ports === null) {
    return NextResponse.json(
      { error: `Tray ${nomor} tidak ada pada OTB ini.` },
      { status: 404 },
    );
  }
  return NextResponse.json(
    { ports },
    { headers: { "Cache-Control": "no-store" } },
  );
});

/** PATCH — mengubah satu port. Teknisi lapangan yang menandai port terpakai. */
export const PATCH = withRole(
  ["admin", "noc", "engineer"],
  async (request, user, ctx: Ctx) => {
    const { otbId, trayNumber } = await ctx.params;
    const nomor = nomorTray(trayNumber);
    if (nomor === null) {
      return NextResponse.json(
        { error: "Nomor tray harus bilangan bulat positif." },
        { status: 400 },
      );
    }

    let body: UbahPortInput & { portNumberInTray?: number };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Body harus JSON yang valid." },
        { status: 400 },
      );
    }
    if (!Number.isInteger(body.portNumberInTray)) {
      return NextResponse.json(
        { error: "portNumberInTray wajib diisi." },
        { status: 400 },
      );
    }

    const hasil = await ubahPort(
      otbId,
      nomor,
      body.portNumberInTray!,
      body,
      user.id,
    );
    if (!hasil.ok) {
      return NextResponse.json({ error: hasil.error }, { status: hasil.status });
    }
    return NextResponse.json(hasil.data);
  },
);
