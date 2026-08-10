#!/usr/bin/env node
// Buat pengguna Portal langsung lewat Better Auth (tanpa UI/HTTP).
//
// Pakai:
//   set -a; source .env.production; set +a
//   node scripts/create-user.mjs --email admin@perumnet.id \
//       --password 'rahasia' --name "Admin NOC" --role admin
//
// Args: --email, --password, --name (opsional), --role (opsional,
// default engineer; admin|noc|engineer|manajemen).
// Idempoten: bila email sudah ada, peran diperbarui (role tidak diturunkan
// bila target sedang admin — kecuali --force).

import { Client } from "pg";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";

function argValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

const email = (argValue("email") ?? "").trim().toLowerCase();
const password = argValue("password") ?? "";
const name = (argValue("name") ?? "").trim() || email.split("@")[0];
const role = (argValue("role") ?? "engineer").trim();
const force = process.argv.includes("--force");

const VALID_ROLES = ["admin", "noc", "engineer", "manajemen"];

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Email tidak valid. Pakai: --email user@domain");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Password minimal 8 karakter.");
  process.exit(1);
}
if (!VALID_ROLES.includes(role)) {
  console.error(`role harus salah satu dari: ${VALID_ROLES.join(", ")}`);
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL wajib di-set di environment.");
  process.exit(1);
}
if (!process.env.BETTER_AUTH_SECRET) {
  console.error("BETTER_AUTH_SECRET wajib di-set di environment.");
  process.exit(1);
}

const pool = new Client({ connectionString: process.env.DATABASE_URL });
await pool.connect();

// Instance auth minimal yang meniru konfigurasi aplikasi (pola src/server/auth.ts).
const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  database: drizzleAdapter(drizzle(pool), { provider: "pg" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
});

const existing = await pool.query(
  'SELECT id, role FROM "user" WHERE email = $1',
  [email],
);

let userId;
let created = false;
if (existing.rows.length > 0) {
  userId = existing.rows[0].id;
  const currentRole = existing.rows[0].role;
  if (currentRole === "admin" && role !== "admin" && !force) {
    console.error(`Akun ${email} sudah ber-peran admin — tidak diturunkan.`);
    await pool.end();
    process.exit(1);
  }
  console.log(`Akun ${email} sudah ada — memperbarui peran → ${role}...`);
} else {
  const signup = await auth.api.signUpEmail({ body: { name, email, password } });
  userId = signup.user.id;
  created = true;
  console.log(`Akun ${email} dibuat.`);
}

await pool.query('UPDATE "user" SET role = $1 WHERE id = $2', [role, userId]);
console.log(`Peran: ${role} (${created ? "baru" : "diperbarui"})`);
await pool.end();
