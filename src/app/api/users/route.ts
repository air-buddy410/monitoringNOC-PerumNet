import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { withRole, type Role } from "@/server/rbac";
import { authProviderMode } from "@/server/mail-auth";
import { createPortalUser } from "@/server/user-provisioning";

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
 * POST /api/users — daftarkan pengguna baru beserta perannya (khusus Admin NOC).
 *
 * Body: { name, email, role? } — role default "engineer".
 *
 * `password` hanya berarti bila AUTH_PROVIDER=LOCAL. Di mode MAILSERVER
 * identitas tinggal di mailcow: yang didaftarkan di sini adalah ALAMAT dan
 * PERANNYA, dan mengirim password justru ditolak supaya tidak ada yang
 * mengira ada password portal terpisah yang perlu diingat.
 *
 * Pendaftaran mandiri ditutup, jadi ini satu-satunya pintu pembuatan akun.
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

  const role =
    typeof body.role === "string" ? (body.role as Role) : "engineer";
  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json(
      { error: `role wajib salah satu dari: ${VALID_ROLES.join(", ")}` },
      { status: 400 },
    );
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      { error: `Nama maksimal ${MAX_NAME_LENGTH} karakter.` },
      { status: 400 },
    );
  }

  const hasil = await createPortalUser({
    name,
    email: typeof body.email === "string" ? body.email : "",
    role,
    password: typeof body.password === "string" ? body.password : undefined,
  });

  if (!hasil.ok) {
    return NextResponse.json({ error: hasil.error }, { status: hasil.status });
  }
  return NextResponse.json(
    { user: hasil.user, authProvider: authProviderMode() },
    { status: 201 },
  );
});
