// Ganti email sendiri saat mode MAILSERVER = mengunci diri sendiri.
//
// Sejak 20 Agustus 2026 login mencocokkan email portal dengan mailbox di
// mailcow. Artinya mengubah email portal ke alamat yang tidak punya mailbox
// membuat akun itu TIDAK BISA DIMASUKI LAGI — dan tidak bisa dibatalkan,
// karena membatalkannya menuntut login.
//
// Tidak ada jalan keluar di dalam aplikasi: `PATCH /api/users/:id` hanya
// mengubah peran, bukan email. Pemulihannya harus lewat database langsung.
// Kalau yang mengunci diri adalah akun darurat, pintu kebakaran ikut hilang.
//
// Sebelum mode MAILSERVER ini tidak berbahaya: password lokal ikut akunnya,
// jadi ganti email cuma ganti nama masuk.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/server/rbac", () => ({
  withRole:
    (_roles: string[], handler: (r: Request, u: unknown, c: unknown) => Promise<Response>) =>
    (request: Request, context: unknown) =>
      handler(request, { id: "u1", name: "Penguji", email: "lama@perumnet.id", role: "noc" }, context),
}));

import * as schema from "@/db/schema";
import { user as userTable } from "@/db/auth-schema";
import { PATCH } from "@/app/api/profile/email/route";
import { GET as AUTH_MODE } from "@/app/api/auth-mode/route";

const MIGRATION_DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const migrationSql = readdirSync(MIGRATION_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATION_DIR, f), "utf8"))
  .join("\n");

let client: PGlite;

function permintaan(email: string): Request {
  return new Request("http://localhost/api/profile/email", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

async function emailTersimpan(): Promise<string> {
  const db = mocks.db as ReturnType<typeof drizzle>;
  const [baris] = await db.select({ email: userTable.email }).from(userTable);
  return baris.email;
}

beforeEach(async () => {
  client = new PGlite();
  await client.exec(migrationSql);
  mocks.db = drizzle(client, { schema });
  const db = mocks.db as ReturnType<typeof drizzle>;
  await db.insert(userTable).values({
    id: "u1", name: "Penguji", email: "lama@perumnet.id", emailVerified: true, role: "noc",
  });
  delete process.env.AUTH_PROVIDER;
});

afterEach(async () => {
  delete process.env.AUTH_PROVIDER;
  await client.close();
});

describe("PATCH /api/profile/email", () => {
  it("mode LOCAL: masih boleh — password lokal ikut akunnya", async () => {
    process.env.AUTH_PROVIDER = "LOCAL";
    const res = await PATCH(permintaan("baru@perumnet.id"), undefined);
    expect(res.status).toBe(200);
    expect(await emailTersimpan()).toBe("baru@perumnet.id");
  });

  it("mode MAILSERVER: DITOLAK, dan email di database tidak berubah", async () => {
    process.env.AUTH_PROVIDER = "MAILSERVER";
    const res = await PATCH(permintaan("tanpa-mailbox@perumnet.id"), undefined);
    expect(res.status).toBe(403);
    // Yang paling penting: bukan cuma kode galatnya, tapi datanya utuh.
    expect(await emailTersimpan()).toBe("lama@perumnet.id");
  });

  it("pesannya menyebut apa yang harus dilakukan, bukan sekadar menolak", async () => {
    process.env.AUTH_PROVIDER = "MAILSERVER";
    const res = await PATCH(permintaan("baru@perumnet.id"), undefined);
    const body = await res.json();
    expect(body.error).toMatch(/mailcow|admin/i);
  });

  it("nilai AUTH_PROVIDER yang salah ketik diperlakukan sebagai LOCAL — sama dengan authProviderMode()", async () => {
    process.env.AUTH_PROVIDER = "MAILSERVERR";
    const res = await PATCH(permintaan("baru@perumnet.id"), undefined);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/auth-mode", () => {
  it("memberi tahu frontend apakah ganti email tersedia", async () => {
    process.env.AUTH_PROVIDER = "MAILSERVER";
    expect((await (await AUTH_MODE()).json()).emailChangeAvailable).toBe(false);
    process.env.AUTH_PROVIDER = "LOCAL";
    expect((await (await AUTH_MODE()).json()).emailChangeAvailable).toBe(true);
  });
});
