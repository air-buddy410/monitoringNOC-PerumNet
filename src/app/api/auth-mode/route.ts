import { NextResponse } from "next/server";
import { authProviderMode } from "@/server/mail-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth-mode
 *
 * Memberitahu frontend cara kerja login yang sedang aktif, supaya form tidak
 * perlu menebak: isian password pada form tambah pengguna, dan form ganti
 * password di halaman profil, hanya berarti pada mode LOCAL.
 *
 * Publik dengan sengaja — halaman login membutuhkannya sebelum ada sesi, dan
 * isinya bukan rahasia: ia hanya menyebut CARA login diperiksa, bukan alamat
 * mailserver, bukan siapa saja yang punya akun.
 */
export function GET() {
  const provider = authProviderMode();
  return NextResponse.json(
    {
      provider,
      /** Password portal hanya ada di mode LOCAL. */
      passwordChangeAvailable: provider === "LOCAL",
      /** Password baru ditentukan admin hanya di mode LOCAL. */
      passwordRequiredOnCreate: provider === "LOCAL",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
