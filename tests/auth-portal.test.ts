// Satu pintu login portal (`POST /api/auth/sign-in/portal`).
//
// Yang diuji di sini adalah keputusan-keputusan yang mahal kalau salah:
// mailserver mati TIDAK boleh jatuh balik ke hash lokal, akun darurat TETAP
// bisa masuk saat mailserver mati, dan pesan galat tidak membocorkan akun
// mana yang ada. PGlite in-memory di-seed dari migration baseline; mailserver
// disuntik lewat probe, tidak ada koneksi jaringan sungguhan.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({
  get db() {
    return mocks.db;
  },
}));

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import * as authSchema from "@/db/auth-schema";
import * as schema from "@/db/schema";
import { portalAuth } from "@/server/auth-portal";
import type { MailAuthResult } from "@/server/mail-auth";

const MIGRATION_DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const migrationSql = readdirSync(MIGRATION_DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(path.join(MIGRATION_DIR, file), "utf8"))
  .join("\n");

const BASE_URL = "http://localhost:3002";
const PASSWORD_LOKAL = "rahasia-lokal-123";

/** Jawaban mailserver untuk permintaan berikutnya, diatur tiap tes. */
let jawabanMailserver: MailAuthResult = { ok: true };

function buatAuth(database: ReturnType<typeof drizzle>) {
  return betterAuth({
    database: drizzleAdapter(database, { provider: "pg" }),
    baseURL: BASE_URL,
    trustedOrigins: [BASE_URL],
    // Dibiarkan menyala HANYA untuk membuat akun uji beserta hash-nya.
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    plugins: [portalAuth({ probe: async () => jawabanMailserver })],
  });
}

let auth: ReturnType<typeof buatAuth>;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  process.env.BETTER_AUTH_SECRET = "rahasia-tes-yang-cukup-panjang-sekali";
  const client = new PGlite();
  await client.exec(migrationSql);
  db = drizzle(client, { schema: { ...schema, ...authSchema } });
  mocks.db = db;

  auth = buatAuth(db);

  await auth.api.signUpEmail({
    body: {
      name: "Budi NOC",
      email: "budi@perumnet.id",
      password: PASSWORD_LOKAL,
    },
  });
  await auth.api.signUpEmail({
    body: {
      name: "Admin Darurat",
      email: "darurat@perumnet.id",
      password: PASSWORD_LOKAL,
    },
  });
  await db
    .update(authSchema.user)
    .set({ allowLocalLogin: true })
    .where(eq(authSchema.user.email, "darurat@perumnet.id"));
});

afterEach(async () => {
  jawabanMailserver = { ok: true };
  await db.delete(schema.auditLogs);
});

async function masuk(email: string, password: string): Promise<Response> {
  return auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/portal`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL },
      body: JSON.stringify({ email, password }),
    }),
  );
}

async function auditTerakhir() {
  const baris = await db.select().from(schema.auditLogs);
  return baris.at(-1);
}

describe("mode MAILSERVER", () => {
  beforeAll(() => {
    process.env.AUTH_PROVIDER = "MAILSERVER";
    process.env.MAILSERVER_URL = "https://mail.perumnet.id";
  });

  it("mailserver menerima → sesi terbit", async () => {
    jawabanMailserver = { ok: true };
    const res = await masuk("budi@perumnet.id", "password-email-benar");

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("session_token");
    const audit = await auditTerakhir();
    expect(audit?.action).toBe("login.berhasil");
    expect(audit?.detail).toMatchObject({ jalur: "mailserver" });
  });

  it("mailserver menolak → 401 dengan kalimat yang sama seperti akun tak dikenal", async () => {
    jawabanMailserver = { ok: false, reason: "REJECTED" };
    const res = await masuk("budi@perumnet.id", "password-salah");
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.message).toBe("Email atau password salah.");
  });

  it("email yang tidak terdaftar → jawaban identik, keberadaan akun tidak bocor", async () => {
    const res = await masuk("orangasing@perumnet.id", "apa-saja");
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.message).toBe("Email atau password salah.");
    const audit = await auditTerakhir();
    expect(audit?.action).toBe("login.gagal");
    expect(audit?.entityId).toBe("tidak-dikenal");
  });

  it("mailserver mati → DITOLAK, tidak jatuh balik ke hash lokal", async () => {
    jawabanMailserver = {
      ok: false,
      reason: "UNREACHABLE",
      detail: "koneksi ditolak",
    };
    // Password lokal yang BENAR sengaja dipakai: kalau ada jalan mundur
    // diam-diam ke hash lokal, tes ini yang menangkapnya. Mematikan mailbox
    // seseorang harus benar-benar berarti mencabut aksesnya.
    const res = await masuk("budi@perumnet.id", PASSWORD_LOKAL);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.message).toContain("Mailserver sedang tidak bisa dihubungi");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("akun darurat tetap masuk lewat hash lokal saat mailserver mati", async () => {
    jawabanMailserver = {
      ok: false,
      reason: "UNREACHABLE",
      detail: "koneksi ditolak",
    };
    const res = await masuk("darurat@perumnet.id", PASSWORD_LOKAL);

    expect(res.status).toBe(200);
    const audit = await auditTerakhir();
    expect(audit?.action).toBe("login.berhasil");
    // Pemakaian pintu darurat harus terlihat di audit, bukan tersembunyi.
    expect(audit?.detail).toMatchObject({ jalur: "lokal-darurat" });
  });

  it("akun darurat dengan password lokal salah tetap ditolak", async () => {
    const res = await masuk("darurat@perumnet.id", "bukan-passwordnya");
    expect(res.status).toBe(401);
  });
});

describe("mode LOCAL", () => {
  beforeAll(() => {
    process.env.AUTH_PROVIDER = "LOCAL";
  });

  it("password lokal benar → masuk, mailserver tidak disentuh", async () => {
    jawabanMailserver = {
      ok: false,
      reason: "UNREACHABLE",
      detail: "seharusnya tidak dipanggil",
    };
    const res = await masuk("budi@perumnet.id", PASSWORD_LOKAL);

    expect(res.status).toBe(200);
    const audit = await auditTerakhir();
    expect(audit?.detail).toMatchObject({ mode: "LOCAL" });
  });

  it("password lokal salah → 401", async () => {
    const res = await masuk("budi@perumnet.id", "salah");
    expect(res.status).toBe(401);
  });
});

describe("masuk dengan username saja", () => {
  beforeAll(() => {
    process.env.AUTH_PROVIDER = "MAILSERVER";
    process.env.MAILSERVER_URL = "https://mail.perumnet.id";
    process.env.LOGIN_DEFAULT_DOMAIN = "perumnet.id";
  });

  afterAll(() => {
    delete process.env.LOGIN_DEFAULT_DOMAIN;
  });

  it("username polos diterima dan sesi terbit", async () => {
    jawabanMailserver = { ok: true };
    const res = await masuk("budi", "password-email-benar");

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("session_token");
  });

  it("yang dicatat di audit alamat LENGKAPNYA, bukan yang diketik", async () => {
    jawabanMailserver = { ok: true };
    await masuk("budi", "password-email-benar");

    // Kalau yang tercatat "budi", dua orang berbeda domain jadi tak
    // terbedakan di jejak audit.
    expect((await auditTerakhir())?.actorLabel).toBe("budi@perumnet.id");
  });

  it("mailserver tetap ditanya dengan alamat lengkap", async () => {
    let ditanya = "";
    const authLokal = betterAuth({
      database: drizzleAdapter(db, { provider: "pg" }),
      baseURL: BASE_URL,
      trustedOrigins: [BASE_URL],
      emailAndPassword: { enabled: true, minPasswordLength: 8 },
      plugins: [
        portalAuth({
          probe: async (_host, email) => {
            ditanya = email;
            return { ok: true };
          },
        }),
      ],
    });
    await authLokal.handler(
      new Request(`${BASE_URL}/api/auth/sign-in/portal`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE_URL },
        body: JSON.stringify({ email: "budi", password: "apa-saja" }),
      }),
    );
    // Mailcow tidak mengenal "budi" — mailbox-nya bernama lengkap.
    expect(ditanya).toBe("budi@perumnet.id");
  });

  it("username yang tidak terdaftar tetap 401, bukan bocor bahwa domainnya benar", async () => {
    const res = await masuk("tidak_ada_orang", "apa-saja");
    expect(res.status).toBe(401);
    expect((await auditTerakhir())?.actorLabel).toBe("tidak_ada_orang@perumnet.id");
  });

  it("akun darurat juga bisa dipanggil dengan username saja", async () => {
    jawabanMailserver = { ok: false, reason: "UNREACHABLE", detail: "mati" };
    const res = await masuk("darurat", PASSWORD_LOKAL);
    // Mailserver mati, tapi ini akun darurat: hash lokal yang dipakai.
    expect(res.status).toBe(200);
  });
});
