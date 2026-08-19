import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));

import * as schema from "@/db/schema";
import { parseUptime, pollPppoe, pppoeConfig } from "@/server/pppoe";
import { cidrValid } from "@/app/api/v1/subnets/route";

const MIGRATION_DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const migrationSql = readdirSync(MIGRATION_DIR)
  .filter((f) => f.endsWith(".sql")).sort()
  .map((f) => readFileSync(path.join(MIGRATION_DIR, f), "utf8")).join("\n");

let client: PGlite;
const T0 = new Date("2026-08-20T00:00:00Z");

async function n(sql: string) {
  return Number((await client.query<{ n: string }>(sql)).rows[0].n);
}

beforeAll(async () => {
  client = new PGlite();
  await client.exec(migrationSql);
  mocks.db = drizzle(client, { schema });
});

beforeEach(async () => {
  await client.exec("DELETE FROM pppoe_sessions; DELETE FROM pppoe_poll_runs;");
});
afterEach(() => vi.unstubAllEnvs());

describe("parseUptime — bentuk RouterOS, bukan ISO", () => {
  it.each([
    ["1w2d03:04:05", 604800 + 172800 + 10800 + 240 + 5],
    ["2d03:04:05", 172800 + 10800 + 240 + 5],
    ["03:04:05", 10800 + 240 + 5],
    ["04:05", 245],
  ])("%s → %i detik", (raw, detik) => {
    expect(parseUptime(raw)).toBe(detik);
  });

  it.each([undefined, "", "kemarin", "3 jam"])("%s → null", (raw) => {
    expect(parseUptime(raw as string | undefined)).toBeNull();
  });
});

describe("cidrValid", () => {
  it.each(["10.20.0.0/24", "192.168.100.0/22", "0.0.0.0/0", "255.255.255.255/32"])(
    "%s sah", (c) => expect(cidrValid(c)).toBe(true));

  // Teks bebas di kolom CIDR membuat IPAM tidak bisa dihitung sama sekali.
  it.each(["10.20.0.0", "256.1.1.1/24", "10.20.0.0/33", "10.20.0/24", "bukan-cidr", ""])(
    "%s ditolak", (c) => expect(cidrValid(c)).toBe(false));
});

describe("pppoeConfig", () => {
  it("kurang satu variabel → null (bukan konfigurasi separuh)", () => {
    vi.stubEnv("MIKROTIK_URL", "https://router.example.test:8444");
    vi.stubEnv("MIKROTIK_USER", "pemantau");
    expect(pppoeConfig()).toBeNull();
    vi.stubEnv("MIKROTIK_PASSWORD", "rahasia");
    expect(pppoeConfig()?.routerName).toBe("router.example.test");
  });
});

describe("pollPppoe", () => {
  // Tugas yang DIAM saat belum dikonfigurasi tidak bisa dibedakan dari tugas
  // yang rusak. Karena itu ia mencatat SKIPPED beserta alasannya.
  it("router belum dikonfigurasi → SKIPPED bercatat, bukan gagal & bukan diam", async () => {
    const r = await pollPppoe({ now: T0 });
    expect(r.status).toBe("SKIPPED");
    // Pesannya menyebut variabel mana yang kurang, bukan sekadar "belum
    // dikonfigurasi" — yang membaca log tidak perlu menebak.
    expect(r.detail).toMatch(/MIKROTIK_URL, MIKROTIK_USER, MIKROTIK_PASSWORD belum diisi/);

    const run = await client.query<{ status: string; error: string }>(
      "SELECT status, error FROM pppoe_poll_runs");
    expect(run.rows[0].status).toBe("SKIPPED");
    expect(run.rows[0].error).toMatch(/MIKROTIK_URL/);
  });

  it("penarikan berhasil → sesi tersimpan + jumlahnya tercatat", async () => {
    const r = await pollPppoe({
      now: T0,
      fetcher: async () => [
        { name: "pelanggan-a", address: "10.20.0.5", "caller-id": "AA:BB", uptime: "03:04:05" },
        { name: "pelanggan-b", address: "10.20.0.6", uptime: "1d00:00:10" },
      ],
    });
    expect(r).toMatchObject({ status: "SUCCESS", sessionCount: 2 });
    expect(await n("SELECT count(*) AS n FROM pppoe_sessions")).toBe(2);

    const s = await client.query<{ username: string; uptime_sec: number }>(
      "SELECT username, uptime_sec FROM pppoe_sessions ORDER BY username");
    expect(s.rows[0]).toEqual({ username: "pelanggan-a", uptime_sec: 11045 });
    expect(s.rows[1].uptime_sec).toBe(86410);
  });

  it("sesi yang tidak lagi dilaporkan hilang — ini gambaran SEKARANG", async () => {
    await pollPppoe({ now: T0, fetcher: async () => [{ name: "a" }, { name: "b" }] });
    await pollPppoe({ now: T0, fetcher: async () => [{ name: "a" }] });
    const s = await client.query<{ username: string }>("SELECT username FROM pppoe_sessions");
    expect(s.rows.map((r) => r.username)).toEqual(["a"]);
  });

  // Lebih baik menampilkan data tua yang bisa diketahui umurnya daripada kosong:
  // daftar kosong terlihat seperti "tidak ada yang online", dan itu keliru.
  it("penarikan GAGAL tidak menghapus gambaran terakhir", async () => {
    await pollPppoe({ now: T0, fetcher: async () => [{ name: "a" }, { name: "b" }] });
    const r = await pollPppoe({
      now: T0,
      fetcher: async () => { throw new Error("router tidak terjangkau"); },
    });
    expect(r.status).toBe("FAILED");
    expect(await n("SELECT count(*) AS n FROM pppoe_sessions")).toBe(2);

    const gagal = await client.query<{ error: string }>(
      "SELECT error FROM pppoe_poll_runs WHERE status = 'FAILED'");
    expect(gagal.rows[0].error).toMatch(/tidak terjangkau/);
  });

  it("tidak menyimpan apa pun selain username & data teknis", async () => {
    await pollPppoe({ now: T0, fetcher: async () => [{ name: "pelanggan-a" }] });
    const kolom = await client.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'pppoe_sessions'");
    const nama = kolom.rows.map((r) => r.column_name);
    // Repo ini publik; kolom identitas pelanggan tidak boleh ada di sini.
    expect(nama).not.toContain("customer_name");
    expect(nama).not.toContain("address_line");
    expect(nama).not.toContain("phone");
  });
});

describe("normalkanUrlRouter — alamat tanpa skema", () => {
  // Terjadi sungguhan 19 Agustus 2026: alamat ditulis "192.168.100.1" tanpa
  // https://, `new URL()` melempar "Invalid URL", dan tugasnya gagal dengan
  // pesan yang tidak menyebut alamat sama sekali.
  it.each([
    ["192.168.100.1", "https://192.168.100.1"],
    ["https://192.168.100.1", "https://192.168.100.1"],
    ["https://192.168.100.1/", "https://192.168.100.1"],
    ["http://192.168.100.1", "http://192.168.100.1"],
    ["router.lokal:8443", "https://router.lokal:8443"],
  ])("%s → %s", async (masuk, keluar) => {
    const { normalkanUrlRouter } = await import("@/server/pppoe");
    expect(normalkanUrlRouter(masuk)).toBe(keluar);
  });

  it.each([undefined, "", "   "])("%s → null", async (masuk) => {
    const { normalkanUrlRouter } = await import("@/server/pppoe");
    expect(normalkanUrlRouter(masuk as string | undefined)).toBeNull();
  });

  it("sebabBelumSiap membedakan 'belum diisi' dari 'bentuknya salah'", async () => {
    const { sebabBelumSiap } = await import("@/server/pppoe");
    vi.stubEnv("MIKROTIK_USER", "pemantau");
    vi.stubEnv("MIKROTIK_PASSWORD", "rahasia");
    vi.stubEnv("MIKROTIK_URL", "");
    expect(sebabBelumSiap()).toMatch(/MIKROTIK_URL belum diisi/);
    vi.stubEnv("MIKROTIK_URL", "192.168.100.1");
    expect(sebabBelumSiap()).toBeNull();
  });
});
