// Pengambil trafik: penemuan, pengambilan, dan pemangkasan.
//
// Router disuntik lewat `fetcher`, jadi seluruh alurnya teruji tanpa satu pun
// koneksi jaringan.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));

import * as schema from "@/db/schema";
import {
  TRAFFIC_TASKS,
  discoverInterfaces,
  pollTraffic,
  pruneTrafficSamples,
  type PengambilRouter,
} from "@/server/traffic";

const MIGRATION_DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const migrationSql = readdirSync(MIGRATION_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATION_DIR, f), "utf8"))
  .join("\n");

let client: PGlite;
let db: ReturnType<typeof drizzle>;
/** Tiap path yang diminta ke router — dasar penjaga privasi di bawah. */
let jalurDiminta: string[] = [];

/** Router palsu: peta nama → counter. */
function buatFetcher(
  ether: string[],
  vlan: string[],
  counter: Record<string, { rx: string; tx: string; running?: string }>,
): PengambilRouter {
  return async (_cfg, jalur) => {
    jalurDiminta.push(jalur);
    if (jalur.startsWith("/rest/interface/ethernet")) {
      return ether.map((name) => ({ name }));
    }
    if (jalur.startsWith("/rest/interface/vlan")) {
      return vlan.map((name) => ({ name }));
    }
    const nama = new URLSearchParams(jalur.split("?")[1] ?? "").get("name") ?? "";
    const c = counter[nama];
    if (!c) return [];
    return [{
      name: nama,
      running: c.running ?? "true",
      "rx-byte": c.rx,
      "tx-byte": c.tx,
    }];
  };
}

beforeAll(() => {
  process.env.MIKROTIK_URL = "https://192.168.100.1";
  process.env.MIKROTIK_USER = "pembaca";
  process.env.MIKROTIK_PASSWORD = "rahasia";
  process.env.MIKROTIK_NAME = "router-uji";
});

beforeEach(async () => {
  client = new PGlite();
  await client.exec(migrationSql);
  db = drizzle(client, { schema });
  mocks.db = db;
  jalurDiminta = [];
});

afterEach(async () => {
  await client.close();
});

const T0 = new Date("2026-08-20T10:00:00.000Z");
const T60 = new Date("2026-08-20T10:01:00.000Z");
const T120 = new Date("2026-08-20T10:02:00.000Z");

describe("discoverInterfaces", () => {
  it("hanya menyapu ethernet & VLAN — TIDAK PERNAH /rest/interface tanpa filter", async () => {
    // Resource umum mengembalikan 1.638 baris yang mayoritas pppoe-in
    // dinamis, dan NAMANYA adalah username pelanggan. Repo ini publik.
    await discoverInterfaces({
      fetcher: buatFetcher(["ether1"], ["vlan100"], {
        ether1: { rx: "1", tx: "1" },
        vlan100: { rx: "1", tx: "1" },
      }),
      now: T0,
    });
    const menyapuSemua = jalurDiminta.filter(
      (j) => j.startsWith("/rest/interface?") && !j.includes("name="),
    );
    expect(menyapuSemua).toEqual([]);
    expect(jalurDiminta.some((j) => j === "/rest/interface")).toBe(false);
  });

  it("menemukan dan menyalakan interface yang running", async () => {
    const pesan = await discoverInterfaces({
      fetcher: buatFetcher(["ether1"], ["vlan100"], {
        ether1: { rx: "1", tx: "1", running: "true" },
        vlan100: { rx: "1", tx: "1", running: "false" },
      }),
      now: T0,
    });
    expect(pesan).toContain("2 baru");
    const rows = await db.select().from(schema.trafficInterfaces);
    expect(rows.find((r) => r.ifName === "ether1")?.isEnabled).toBe(true);
    expect(rows.find((r) => r.ifName === "vlan100")?.isEnabled).toBe(false);
  });

  it("TIDAK PERNAH menyalakan kembali yang sengaja dimatikan operator", async () => {
    const f = buatFetcher(["ether1"], [], { ether1: { rx: "1", tx: "1" } });
    await discoverInterfaces({ fetcher: f, now: T0 });
    await db
      .update(schema.trafficInterfaces)
      .set({ isEnabled: false, label: "Dimatikan operator" })
      .where(eq(schema.trafficInterfaces.ifName, "ether1"));

    await discoverInterfaces({ fetcher: f, now: T60 });

    const [row] = await db.select().from(schema.trafficInterfaces);
    expect(row.isEnabled).toBe(false);
    expect(row.label).toBe("Dimatikan operator");
  });

  it("interface yang hilang ditandai, bukan dihapus", async () => {
    await discoverInterfaces({
      fetcher: buatFetcher(["ether1"], [], { ether1: { rx: "1", tx: "1" } }),
      now: T0,
    });
    await discoverInterfaces({ fetcher: buatFetcher([], [], {}), now: T60 });
    const [row] = await db.select().from(schema.trafficInterfaces);
    expect(row.missingSince).not.toBeNull();
  });
});

describe("pollTraffic", () => {
  async function siapkan(counter: Record<string, { rx: string; tx: string }>) {
    await discoverInterfaces({
      fetcher: buatFetcher(Object.keys(counter), [], counter),
      now: T0,
    });
  }

  it("tanpa interface dipantau → dilewati dengan alasan, bukan diam", async () => {
    const h = await pollTraffic({ fetcher: buatFetcher([], [], {}), now: T0 });
    expect(h.pesan).toContain("belum ada interface");
  });

  it("putaran pertama jadi acuan, putaran kedua baru menghasilkan laju", async () => {
    await siapkan({ ether1: { rx: "1000000000", tx: "0" } });

    const p1 = await pollTraffic({
      fetcher: buatFetcher([], [], { ether1: { rx: "1000000000", tx: "0" } }),
      now: T60,
    });
    expect(p1.tercatat).toBe(0);
    expect(p1.ditolak.PERTAMA).toBe(1);

    const p2 = await pollTraffic({
      fetcher: buatFetcher([], [], { ether1: { rx: "1075000000", tx: "0" } }),
      now: T120,
    });
    expect(p2.tercatat).toBe(1);

    const rows = await db.select().from(schema.trafficSamples);
    const berlaju = rows.filter((r) => r.dtMs > 0);
    expect(berlaju).toHaveLength(1);
    expect(berlaju[0].rxBps).toBe(10_000_000);
  });

  it("counter yang di-reset TIDAK menghasilkan titik", async () => {
    await siapkan({ ether1: { rx: "5000000000", tx: "0" } });
    await pollTraffic({
      fetcher: buatFetcher([], [], { ether1: { rx: "5000000000", tx: "0" } }),
      now: T60,
    });
    const h = await pollTraffic({
      fetcher: buatFetcher([], [], { ether1: { rx: "12000", tx: "0" } }),
      now: T120,
    });
    expect(h.tercatat).toBe(0);
    expect(h.ditolak.RESET).toBe(1);
    expect((await db.select().from(schema.trafficSamples)).filter((r) => r.dtMs > 0)).toHaveLength(0);
  });

  it("interface yang tidak dijawab router dihitung, bukan menjatuhkan putaran", async () => {
    await siapkan({ ether1: { rx: "1", tx: "1" } });
    const h = await pollTraffic({ fetcher: buatFetcher([], [], {}), now: T60 });
    expect(h.ditolak.HILANG).toBe(1);
    expect(h.diperiksa).toBe(1);
  });

  it("counter cacat ditolak, tidak diperlakukan sebagai nol", async () => {
    await siapkan({ ether1: { rx: "1", tx: "1" } });
    const h = await pollTraffic({
      fetcher: buatFetcher([], [], { ether1: { rx: "bukan-angka", tx: "1" } }),
      now: T60,
    });
    expect(h.ditolak.COUNTER_CACAT).toBe(1);
  });
});

describe("pruneTrafficSamples", () => {
  it("membuang yang tua, menyisakan yang baru, dan melaporkan jumlahnya", async () => {
    await discoverInterfaces({
      fetcher: buatFetcher(["ether1"], [], { ether1: { rx: "1", tx: "1" } }),
      now: T0,
    });
    const [iface] = await db.select().from(schema.trafficInterfaces);
    await db.insert(schema.trafficSamples).values([
      { interfaceId: iface.id, sampledAt: new Date("2026-08-01T00:00:00Z"),
        rxBps: 1, txBps: 1, rxByte: BigInt(1), txByte: BigInt(1), dtMs: 60000 },
      { interfaceId: iface.id, sampledAt: new Date("2026-08-20T09:00:00Z"),
        rxBps: 1, txBps: 1, rxByte: BigInt(2), txByte: BigInt(2), dtMs: 60000 },
    ]);
    expect(await pruneTrafficSamples(7, T0)).toBe(1);
    expect(await db.select().from(schema.trafficSamples)).toHaveLength(1);
  });
});

describe("pendaftaran tugas", () => {
  it("ketiganya MEMBACA saja, jadi boleh menyala secara bawaan", () => {
    // Daftarnya sengaja lengkap dan berurutan, bukan sekadar hitungan:
    // menambah tugas harus memaksa seseorang membaca ulang apakah tugas itu
    // benar-benar boleh menyala sendiri.
    //
    // Ukurannya "tidak bertindak keluar", bukan "tidak menulis" — ketiganya
    // menulis ke database portal sendiri, dan itu diizinkan. Yang tidak
    // diizinkan adalah mengubah konfigurasi perangkat; tidak satu pun dari
    // ketiganya mengirim apa pun selain GET ke router.
    expect(TRAFFIC_TASKS.map((t) => [t.code, t.enabledByDefault])).toEqual([
      ["traffic.poll", true],
      ["traffic.discover", true],
      ["traffic.prune", true],
    ]);
  });
});
