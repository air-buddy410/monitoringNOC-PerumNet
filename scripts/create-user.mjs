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
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// Schema minimal yang dibutuhkan adapter Better Auth — kolom mengikuti
// src/db/auth-schema.ts (termasuk additionalFields role).
const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  role: text("role").default("engineer"),
});

const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id").notNull(),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

const schema = { user, session, account, verification };

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
  database: drizzleAdapter(drizzle(pool, { schema }), {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "engineer",
        input: false,
      },
    },
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
