// Penjaga rute verifikasi channel bot.
//
// Sampai 19 Agustus 2026 rute ini menulis ke database tanpa sesi, tanpa token,
// dan tanpa rate limit — kendalinya hanya kode 6 digit yang tidak pernah
// kedaluwarsa, pada host yang terbuka di internet. Tes ini yang menahannya
// tidak kembali terbuka.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));

import * as schema from "@/db/schema";
import { POST } from "@/app/api/notifications/channels/verify/route";

const MIGRATION_DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const migrationSql = readdirSync(MIGRATION_DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(path.join(MIGRATION_DIR, file), "utf8"))
  .join("\n");

let client: PGlite;
const SECRET = "rahasia-bot-uji";

function verifyRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/api/notifications/channels/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  client = new PGlite();
  await client.exec(migrationSql);
  mocks.db = drizzle(client, { schema });
});

beforeEach(async () => {
  vi.stubEnv("NOTIFICATION_BOT_SECRET", SECRET);
  await client.query("DELETE FROM notification_channels");
  await client.query(
    `INSERT INTO notification_channels (id, type, recipient_name, target, verification_code, verified, active)
     VALUES ('ch-pending', 'telegram', 'NOC Piket', 'noc-piket', '123456', false, false)`,
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/notifications/channels/verify", () => {
  it("tanpa token → 401, dan channel TIDAK tertaut", async () => {
    const response = await POST(
      verifyRequest({ code: "123456", chatId: "penyerang-999" }),
    );
    expect(response.status).toBe(401);

    const rows = await client.query<{ verified: boolean; chat_id: string | null }>(
      "SELECT verified, chat_id FROM notification_channels WHERE id = 'ch-pending'",
    );
    expect(rows.rows[0].verified).toBe(false);
    expect(rows.rows[0].chat_id).toBeNull();
  });

  it("token salah → 401", async () => {
    const response = await POST(
      verifyRequest(
        { code: "123456", chatId: "penyerang-999" },
        { "x-bot-token": "tebakan" },
      ),
    );
    expect(response.status).toBe(401);
  });

  it("token benar → tertaut", async () => {
    const response = await POST(
      verifyRequest(
        { code: "123456", chatId: "chat-sah-1" },
        { "x-bot-token": SECRET, "x-forwarded-for": "10.0.0.1" },
      ),
    );
    expect(response.status).toBe(200);

    const rows = await client.query<{ verified: boolean; chat_id: string }>(
      "SELECT verified, chat_id FROM notification_channels WHERE id = 'ch-pending'",
    );
    expect(rows.rows[0].verified).toBe(true);
    expect(rows.rows[0].chat_id).toBe("chat-sah-1");
  });

  it("secret server belum diisi → 503, bukan pintu terbuka", async () => {
    vi.stubEnv("NOTIFICATION_BOT_SECRET", "");
    const response = await POST(
      verifyRequest({ code: "123456", chatId: "siapa-saja" }),
    );
    expect(response.status).toBe(503);

    const rows = await client.query<{ verified: boolean }>(
      "SELECT verified FROM notification_channels WHERE id = 'ch-pending'",
    );
    expect(rows.rows[0].verified).toBe(false);
  });

  it("menebak kode beruntun → 429 sebelum ruang 6 digit habis", async () => {
    const ip = "203.0.113.7";
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await POST(
        verifyRequest(
          { code: String(200000 + attempt), chatId: "penyerang-999" },
          { "x-bot-token": SECRET, "x-forwarded-for": ip },
        ),
      );
      statuses.push(response.status);
    }
    expect(statuses).toContain(429);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(2);
  });
});
