// Pembuatan akun portal yang sadar mode (integrasi mailcow).
//
// Yang dijaga: di mode MAILSERVER tidak boleh ada password portal kedua yang
// bisa berbeda dari password email — kecuali untuk akun darurat, yang justru
// wajib punya.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  process.env.BETTER_AUTH_SECRET = "rahasia-tes-yang-cukup-panjang-sekali";
  return { db: undefined as unknown };
});
vi.mock("@/db", () => ({
  get db() {
    return mocks.db;
  },
}));

import * as authSchema from "@/db/auth-schema";
import * as schema from "@/db/schema";

// Diimpor DINAMIS setelah PGlite berdiri: `@/server/auth` memanggil
// drizzleAdapter(db) saat modul dimuat, jadi kalau diimpor statis ia menangkap
// db yang masih undefined.
type CreatePortalUser =
  typeof import("@/server/user-provisioning")["createPortalUser"];
let createPortalUser: CreatePortalUser;

const MIGRATION_DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const migrationSql = readdirSync(MIGRATION_DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(path.join(MIGRATION_DIR, file), "utf8"))
  .join("\n");

let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  const client = new PGlite();
  await client.exec(migrationSql);
  db = drizzle(client, { schema: { ...schema, ...authSchema } });
  mocks.db = db;
  ({ createPortalUser } = await import("@/server/user-provisioning"));
});

afterEach(async () => {
  await db.delete(authSchema.account);
  await db.delete(authSchema.user);
  delete process.env.AUTH_PROVIDER;
});

async function akunKredensial(userId: string) {
  const baris = await db
    .select()
    .from(authSchema.account)
    .where(eq(authSchema.account.userId, userId));
  return baris.find((row) => row.providerId === "credential");
}

describe("mode MAILSERVER", () => {
  beforeAll(() => {
    process.env.AUTH_PROVIDER = "MAILSERVER";
  });

  it("akun biasa dibuat tanpa password lokal sama sekali", async () => {
    process.env.AUTH_PROVIDER = "MAILSERVER";
    const hasil = await createPortalUser({
      name: "Sari NOC",
      email: "Sari@Perumnet.id",
      role: "noc",
    });

    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;
    // Alamat disimpan huruf kecil supaya pencocokan saat login konsisten.
    expect(hasil.user.email).toBe("sari@perumnet.id");
    // Tidak ada hash tersimpan: satu-satunya password yang berlaku adalah
    // password email di mailcow.
    expect(await akunKredensial(hasil.user.id)).toBeUndefined();
  });

  it("password yang dikirim justru ditolak, dengan alasan yang menjelaskan", async () => {
    process.env.AUTH_PROVIDER = "MAILSERVER";
    const hasil = await createPortalUser({
      name: "Sari NOC",
      email: "sari2@perumnet.id",
      role: "noc",
      password: "password-portal-123",
    });

    expect(hasil).toMatchObject({ ok: false, status: 400 });
    if (hasil.ok) return;
    expect(hasil.error).toContain("password email dari mailcow");
  });

  it("akun darurat WAJIB punya password lokal, dan hash-nya tersimpan", async () => {
    process.env.AUTH_PROVIDER = "MAILSERVER";
    const tanpaPassword = await createPortalUser({
      name: "Admin Darurat",
      email: "darurat@perumnet.id",
      role: "admin",
      allowLocalLogin: true,
    });
    expect(tanpaPassword).toMatchObject({ ok: false, status: 400 });

    const hasil = await createPortalUser({
      name: "Admin Darurat",
      email: "darurat@perumnet.id",
      role: "admin",
      password: "kunci-darurat-123",
      allowLocalLogin: true,
    });
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;

    const kredensial = await akunKredensial(hasil.user.id);
    expect(kredensial?.password).toBeTruthy();
    // Yang tersimpan hash, bukan password apa adanya.
    expect(kredensial?.password).not.toContain("kunci-darurat-123");

    const [baris] = await db
      .select({ allowLocalLogin: authSchema.user.allowLocalLogin })
      .from(authSchema.user)
      .where(eq(authSchema.user.id, hasil.user.id));
    expect(baris.allowLocalLogin).toBe(true);
  });
});

describe("mode LOCAL", () => {
  it("password wajib dan minimal 8 karakter", async () => {
    process.env.AUTH_PROVIDER = "LOCAL";
    const pendek = await createPortalUser({
      name: "Budi",
      email: "budi@perumnet.id",
      role: "engineer",
      password: "pendek",
    });
    expect(pendek).toMatchObject({ ok: false, status: 400 });

    const hasil = await createPortalUser({
      name: "Budi",
      email: "budi@perumnet.id",
      role: "engineer",
      password: "password-cukup-panjang",
    });
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;
    expect(await akunKredensial(hasil.user.id)).toBeTruthy();
  });
});

describe("aturan yang berlaku di kedua mode", () => {
  it("email ganda ditolak 409", async () => {
    process.env.AUTH_PROVIDER = "MAILSERVER";
    await createPortalUser({
      name: "Sari",
      email: "kembar@perumnet.id",
      role: "noc",
    });
    const kedua = await createPortalUser({
      name: "Sari Lain",
      email: "KEMBAR@perumnet.id",
      role: "noc",
    });
    expect(kedua).toMatchObject({ ok: false, status: 409 });
  });

  it("email tidak valid ditolak sebelum menyentuh database", async () => {
    process.env.AUTH_PROVIDER = "MAILSERVER";
    const hasil = await createPortalUser({
      name: "Tanpa Email",
      email: "bukan-email",
      role: "noc",
    });
    expect(hasil).toMatchObject({ ok: false, status: 400 });
  });
});
