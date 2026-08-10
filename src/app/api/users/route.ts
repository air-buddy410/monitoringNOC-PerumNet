import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { auth } from "@/server/auth";
import { withRole, type Role } from "@/server/rbac";

export const dynamic = "force-dynamic";

const VALID_ROLES: Role[] = ["admin", "noc", "engineer", "manajemen"];
const MAX_NAME_LENGTH = 80;

/**
 * GET /api/users — daftar seluruh pengguna aplikasi beserta perannya.
 * Hanya untuk Admin NOC.
 */
export const GET = withRole(["admin"], async () => {
  const users = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(asc(user.createdAt))
    ;

  return NextResponse.json({ users, total: users.length });
});

interface CreateUserBody {
  name?: unknown;
  email?: unknown;
  password?: unknown;
  role?: unknown;
}

/**
 * POST /api/users — buat pengguna baru beserta perannya (khusus Admin NOC).
 * Body: { name, email, password, role? } — role default "engineer".
 * Registrasi publik ditutup, jadi ini satu-satunya pintu pembuatan akun.
 */
export const POST = withRole(["admin"], async (request) => {
  let body: CreateUserBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body harus JSON yang valid." },
      { status: 400 },
    );
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const role =
    typeof body.role === "string" ? (body.role as Role) : "engineer";

  if (!name || name.length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      { error: `Nama wajib diisi (maksimal ${MAX_NAME_LENGTH} karakter).` },
      { status: 400 },
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Email tidak valid." },
      { status: 400 },
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password minimal 8 karakter." },
      { status: 400 },
    );
  }
  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json(
      { error: `role wajib salah satu dari: ${VALID_ROLES.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const created = await auth.api.signUpEmail({
      body: { name, email, password },
    });
    await db.update(user).set({ role }).where(eq(user.id, created.user.id));
    return NextResponse.json(
      {
        user: {
          id: created.user.id,
          name: created.user.name,
          email: created.user.email,
          role,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("user already exists")) {
      return NextResponse.json(
        { error: `Email ${email} sudah terdaftar.` },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Gagal membuat pengguna." },
      { status: 400 },
    );
  }
});
