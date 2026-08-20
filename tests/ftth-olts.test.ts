// Daftar OLT untuk layar konsol.
//
// Dua hal yang dijaga di sini, dan keduanya bisa bocor tanpa terlihat:
//
//   1. `credentialRef` — nama env var kredensial perangkat — TIDAK boleh ikut
//      terkirim. Ia memang bukan kata sandi, tapi ia menunjuk langsung ke
//      tempat kata sandinya disimpan, dan tidak ada layar yang membutuhkannya.
//   2. `konsolSiap` harus dihitung dengan pemeriksaan yang SAMA dengan yang
//      dipakai saat menyambung. Kalau ia jadi tebakan sendiri, layar akan
//      menawarkan perangkat yang sebetulnya gagal — atau menyembunyikan yang
//      sebetulnya jalan.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  role: "admin" as string,
}));

vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/server/rbac", () => ({
  withRole:
    (_roles: string[], handler: (r: Request, u: unknown, c: unknown) => Promise<Response>) =>
    (request: Request, context: unknown) =>
      handler(
        request,
        { id: "u1", name: "Penguji", email: "uji@contoh.id", role: mocks.role },
        context,
      ),
}));

import * as schema from "@/db/schema";
import { GET } from "@/app/api/v1/ftth/olts/route";

const MIGRATION_DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const migrationSql = readdirSync(MIGRATION_DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(path.join(MIGRATION_DIR, file), "utf8"))
  .join("\n");

let client: PGlite;

async function panggil(): Promise<{ olts: Array<Record<string, unknown>>; konsolTersedia: boolean }> {
  const res = await GET(new Request("http://localhost/api/v1/ftth/olts"), undefined);
  expect(res.status).toBe(200);
  return res.json();
}

beforeAll(() => {
  process.env.OLT_UJI_CRED = "pembaca:sandi";
  delete process.env.OLT_KOSONG_CRED;
});

beforeEach(async () => {
  client = new PGlite();
  await client.exec(migrationSql);
  mocks.db = drizzle(client, { schema });
  mocks.role = "admin";

  const db = mocks.db as ReturnType<typeof drizzle>;
  await db.insert(schema.networkSites).values({ id: "s1", code: "KCC", name: "Kecicang" });
  await db.insert(schema.oltDevices).values([
    // Siap: punya port DAN env var-nya terisi.
    { id: "olt-siap", name: "OLT Siap", managementIp: "10.0.0.1", siteId: "s1",
      telnetPort: 1023, credentialRef: "OLT_UJI_CRED" },
    // Env var-nya belum di-set di proses ini.
    { id: "olt-tanpa-env", name: "OLT Tanpa Env", managementIp: "10.0.0.2",
      telnetPort: 23, credentialRef: "OLT_KOSONG_CRED" },
    // Tidak punya telnet_port sama sekali.
    { id: "olt-tanpa-port", name: "OLT Tanpa Port", managementIp: "10.0.0.3",
      credentialRef: "OLT_UJI_CRED" },
  ]);
  await db.insert(schema.odps).values([
    { id: "odp1", code: "ODP-1", name: "ODP Satu", oltId: "olt-siap", capacity: 8 },
    { id: "odp2", code: "ODP-2", name: "ODP Dua", oltId: "olt-siap", capacity: 8 },
  ]);
});

afterEach(async () => {
  await client.close();
});

describe("GET /api/v1/ftth/olts", () => {
  it("tidak pernah mengirim credentialRef, apa pun perannya", async () => {
    for (const peran of ["admin", "noc", "engineer", "manajemen"]) {
      mocks.role = peran;
      const { olts } = await panggil();
      for (const olt of olts) {
        expect(Object.keys(olt), peran).not.toContain("credentialRef");
      }
      // Nilainya pun tidak boleh muncul di mana-mana, termasuk di dalam alasan.
      expect(JSON.stringify(olts), peran).not.toContain("OLT_UJI_CRED");
    }
  });

  it("menandai siap hanya bila port DAN kredensialnya benar-benar terbaca", async () => {
    const { olts } = await panggil();
    const per = Object.fromEntries(olts.map((o) => [o.id as string, o]));
    expect(per["olt-siap"].konsolSiap).toBe(true);
    expect(per["olt-siap"].alasan).toBeNull();
    expect(per["olt-tanpa-env"].konsolSiap).toBe(false);
    expect(per["olt-tanpa-port"].konsolSiap).toBe(false);
  });

  it("menyebut env var yang kurang hanya kepada peran yang boleh membuka konsol", async () => {
    for (const peran of ["admin", "noc"]) {
      mocks.role = peran;
      const { olts, konsolTersedia } = await panggil();
      expect(konsolTersedia, peran).toBe(true);
      const kurang = olts.find((o) => o.id === "olt-tanpa-env");
      expect(kurang?.alasan, peran).toContain("OLT_KOSONG_CRED");
    }
    for (const peran of ["engineer", "manajemen"]) {
      mocks.role = peran;
      const { olts, konsolTersedia } = await panggil();
      expect(konsolTersedia, peran).toBe(false);
      const kurang = olts.find((o) => o.id === "olt-tanpa-env");
      expect(kurang?.alasan, peran).not.toContain("OLT_KOSONG_CRED");
      expect(kurang?.alasan, peran).toBe("Konsol perangkat ini belum siap dipakai.");
    }
  });

  it("membawa nama site dan jumlah ODP supaya layar tidak perlu memanggil dua kali", async () => {
    const { olts } = await panggil();
    const siap = olts.find((o) => o.id === "olt-siap");
    expect(siap?.siteName).toBe("Kecicang");
    expect(siap?.odpCount).toBe(2);
    expect(olts.find((o) => o.id === "olt-tanpa-port")?.odpCount).toBe(0);
  });

  it("diurutkan menurut nama supaya pilihan di layar tidak berpindah-pindah", async () => {
    const { olts } = await panggil();
    expect(olts.map((o) => o.name)).toEqual([...olts.map((o) => o.name)].sort());
  });
});
