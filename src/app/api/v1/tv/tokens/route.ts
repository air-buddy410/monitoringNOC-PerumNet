import { NextResponse } from "next/server";
import { withRole } from "@/server/rbac";
import { buatToken, daftarToken } from "@/server/tv-token";

export const dynamic = "force-dynamic";

/** GET — daftar token. TIDAK PERNAH memuat token maupun hash-nya. */
export const GET = withRole(["admin"], async () => {
  return NextResponse.json(
    { tokens: await daftarToken() },
    { headers: { "Cache-Control": "no-store" } },
  );
});

/**
 * POST — membuat token baru.
 *
 * Token polos dikembalikan **sekali** dan tidak pernah bisa dibaca lagi dari
 * mana pun; yang tersimpan hanya SHA-256-nya.
 */
export const POST = withRole(["admin"], async (request, user) => {
  let body: { name?: unknown; expiresInDays?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body harus JSON yang valid." }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) {
    return NextResponse.json(
      { error: "name wajib diisi, maksimal 80 karakter." },
      { status: 400 },
    );
  }
  const hari =
    typeof body.expiresInDays === "number" ? body.expiresInDays : undefined;

  const t = await buatToken({ name, createdBy: user.id, expiresInDays: hari });
  const asal = process.env.BETTER_AUTH_URL?.replace(/\/+$/, "") ?? "";
  return NextResponse.json(
    {
      id: t.id,
      name: t.name,
      token: t.token,
      // Fragmen, bukan query: fragmen tidak pernah dikirim ke server, jadi ia
      // tidak masuk access log dan tidak pernah bocor lewat header Referer.
      url: `${asal}/tv#token=${t.token}`,
      expiresAt: t.expiresAt.toISOString(),
      peringatan: "Token ini hanya ditampilkan sekali. Simpan sekarang.",
    },
    { status: 201 },
  );
});
