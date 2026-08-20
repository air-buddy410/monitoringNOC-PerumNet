import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { authProviderMode } from "@/server/mail-auth";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * PATCH /api/profile/email — ganti email akun yang sedang login.
 * (Better Auth change-email membutuhkan alur verifikasi email; endpoint ini
 * memperbarui langsung dan menandai email sebagai belum terverifikasi.)
 *
 * **Mati di mode MAILSERVER, dan itu bukan pembatasan yang berlebihan.**
 * Sejak login mencocokkan email portal dengan mailbox di mailcow, mengganti
 * email sendiri ke alamat tanpa mailbox berarti akun itu tidak bisa dimasuki
 * lagi — dan tidak bisa dibatalkan, karena membatalkannya menuntut login.
 *
 * Tidak ada jalan keluar di dalam aplikasi: `PATCH /api/users/:id` hanya
 * mengubah peran. Pemulihannya harus lewat database langsung:
 *
 *   UPDATE "user" SET email = '<alamat mailbox yang benar>' WHERE id = '<id>';
 *
 * Dan kalau yang mengunci diri adalah akun darurat, pintu kebakaran ikut
 * hilang bersamanya.
 *
 * Di mode LOCAL ini tetap aman — password lokal ikut akunnya, jadi ganti email
 * cuma ganti nama masuk.
 */
export const PATCH = withRole([], async (request, sessionUser) => {
  if (authProviderMode() === "MAILSERVER") {
    return NextResponse.json(
      {
        error:
          "Mode mailserver: alamat email adalah identitas di mailcow, jadi tidak bisa diganti sendiri dari sini. Minta admin mengubahnya setelah mailbox-nya siap.",
      },
      { status: 403 },
    );
  }

  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body harus JSON yang valid." },
      { status: 400 },
    );
  }
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json(
      { error: "email tidak valid." },
      { status: 400 },
    );
  }

  const [taken] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  if (taken && taken.id !== sessionUser.id) {
    return NextResponse.json(
      { error: `Email ${email} sudah dipakai akun lain.` },
      { status: 409 },
    );
  }

  await db
    .update(user)
    .set({ email, emailVerified: false })
    .where(eq(user.id, sessionUser.id));

  return NextResponse.json({
    user: { id: sessionUser.id, name: sessionUser.name, email },
  });
});
