// Satu-satunya tempat akun portal dibuat.
//
// Sebelum integrasi mailcow, akun dibuat lewat `auth.api.signUpEmail`. Di
// mode MAILSERVER jalur itu ditutup (lihat auth.ts) — dan memang seharusnya:
// identitas tinggal di mailcow, jadi membuat akun portal berarti mendaftarkan
// ALAMAT dan PERANNYA, bukan menyimpan password kedua yang bisa berbeda dari
// password email.
//
// Kecuali akun darurat: ia justru harus punya password lokal, karena gunanya
// adalah masuk saat mailserver mati.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user as userTable } from "@/db/auth-schema";
import { auth } from "@/server/auth";
import { authProviderMode } from "@/server/mail-auth";
import type { Role } from "@/server/rbac";

export const MIN_LOCAL_PASSWORD = 8;

export interface CreatePortalUserInput {
  name: string;
  email: string;
  role: Role;
  /**
   * Hanya dipakai bila akun butuh password lokal: mode LOCAL, atau akun
   * darurat di mode apa pun. Di mode MAILSERVER untuk akun biasa, nilai ini
   * DITOLAK — supaya tidak ada yang mengira password portal itu berarti.
   */
  password?: string;
  /** Akun darurat (pintu kebakaran saat mailserver mati). */
  allowLocalLogin?: boolean;
}

export type CreatePortalUserResult =
  | { ok: true; user: { id: string; name: string; email: string; role: Role } }
  | { ok: false; status: 400 | 409; error: string };

/** Apakah akun ini perlu password yang disimpan lokal? */
export function butuhPasswordLokal(allowLocalLogin: boolean): boolean {
  return authProviderMode() === "LOCAL" || allowLocalLogin;
}

export async function createPortalUser(
  input: CreatePortalUserInput,
): Promise<CreatePortalUserResult> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const allowLocalLogin = input.allowLocalLogin ?? false;
  const password = input.password ?? "";
  const perluPassword = butuhPasswordLokal(allowLocalLogin);

  if (!name) return { ok: false, status: 400, error: "Nama wajib diisi." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, status: 400, error: "Email tidak valid." };
  }

  if (perluPassword) {
    if (password.length < MIN_LOCAL_PASSWORD) {
      return {
        ok: false,
        status: 400,
        error: `Password minimal ${MIN_LOCAL_PASSWORD} karakter.`,
      };
    }
  } else if (password) {
    return {
      ok: false,
      status: 400,
      error:
        "Mode mailserver: akun memakai password email dari mailcow, jadi password di sini tidak dipakai. Kosongkan isiannya.",
    };
  }

  const [terpakai] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, email))
    .limit(1);
  if (terpakai) {
    return { ok: false, status: 409, error: `Email ${email} sudah terdaftar.` };
  }

  const ctx = await auth.$context;
  const dibuat = await ctx.internalAdapter.createUser({
    email,
    name,
    // Alamatnya berasal dari mailcow (atau didaftarkan admin), bukan dari
    // orang asing yang mendaftar sendiri — tidak ada yang perlu diverifikasi
    // ulang lewat email.
    emailVerified: true,
  });
  if (!dibuat) {
    return { ok: false, status: 400, error: "Gagal membuat pengguna." };
  }

  if (perluPassword) {
    const hash = await ctx.password.hash(password);
    await ctx.internalAdapter.linkAccount({
      userId: dibuat.id,
      providerId: "credential",
      accountId: dibuat.id,
      password: hash,
    });
  }

  // `role` sengaja bukan input Better Auth (input: false), jadi disetel di
  // sini — sekalian dengan penanda akun darurat.
  await db
    .update(userTable)
    .set({ role: input.role, allowLocalLogin })
    .where(eq(userTable.id, dibuat.id));

  return {
    ok: true,
    user: { id: dibuat.id, name, email, role: input.role },
  };
}
