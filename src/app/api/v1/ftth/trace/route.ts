import { NextResponse } from "next/server";
import { withRole } from "@/server/rbac";
import { telusuri } from "@/server/trace-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/ftth/trace?dari=<jenis>&id=<id>[&ujung=A|B]
 *
 * `dari` = `otbPort` | `odpPort` | `core`. Untuk `core`, `ujung` wajib —
 * sebuah core punya dua ujung dan menelusuri dari ujung yang berbeda
 * menghasilkan jalur yang berbeda.
 *
 * Hasilnya DAFTAR jalur, bukan satu. Melewati master splitter membuat satu
 * jalur bercabang, dan tiap cabang punya ujung serta diagnosisnya sendiri.
 */
export const GET = withRole([], async (request) => {
  const q = new URL(request.url).searchParams;
  const dari = q.get("dari");
  const id = q.get("id");
  const ujung = q.get("ujung");

  if (!id) {
    return NextResponse.json({ error: "Parameter id wajib diisi." }, { status: 400 });
  }

  let mulai;
  if (dari === "otbPort") {
    mulai = { jenis: "otbPort" as const, id };
  } else if (dari === "odpPort") {
    mulai = { jenis: "odpPort" as const, id };
  } else if (dari === "core") {
    if (ujung !== "A" && ujung !== "B") {
      return NextResponse.json(
        { error: "Menelusuri dari core butuh ujung=A atau ujung=B." },
        { status: 400 },
      );
    }
    mulai = { jenis: "coreEnd" as const, coreId: id, ujung: ujung as "A" | "B" };
  } else {
    return NextResponse.json(
      { error: "Parameter dari harus otbPort, odpPort, atau core." },
      { status: 400 },
    );
  }

  const hasil = await telusuri(mulai);
  if (!hasil) {
    return NextResponse.json({ error: "Titik awal tidak ditemukan." }, { status: 404 });
  }
  return NextResponse.json(hasil, { headers: { "Cache-Control": "no-store" } });
});
