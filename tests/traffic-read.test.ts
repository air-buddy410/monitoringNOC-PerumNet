// Pembacaan trafik untuk layar.
//
// Yang dijaga di sini semuanya soal SATU perbedaan: "nol" tidak sama dengan
// "tidak tahu". Layar yang menggambar keduanya sama akan melaporkan gangguan
// yang tidak pernah terjadi — dan itu kegagalan yang paling mahal di fitur
// ini, karena ia terlihat meyakinkan.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));

import * as schema from "@/db/schema";
import { bacaDeretTrafik, bacaTrafikLive } from "@/server/traffic-read";

const MIGRATION_DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const migrationSql = readdirSync(MIGRATION_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATION_DIR, f), "utf8"))
  .join("\n");

let client: PGlite;
let db: ReturnType<typeof drizzle>;

const T = (iso: string) => new Date(iso);
const SEKARANG = T("2026-08-20T10:05:00.000Z");

async function buatInterface(over: Partial<typeof schema.trafficInterfaces.$inferInsert> = {}) {
  const id = over.id ?? `if-${Math.random().toString(36).slice(2, 8)}`;
  await db.insert(schema.trafficInterfaces).values({
    id,
    routerName: "router-uji",
    ifName: over.ifName ?? id,
    label: over.label ?? id,
    isEnabled: true,
    ...over,
  });
  return id;
}

async function sampel(
  interfaceId: string,
  iso: string,
  rxBps: number,
  txBps: number,
  dtMs: number,
) {
  await db.insert(schema.trafficSamples).values({
    interfaceId,
    sampledAt: T(iso),
    rxBps,
    txBps,
    rxByte: BigInt(1),
    txByte: BigInt(1),
    dtMs,
  });
}

beforeEach(async () => {
  client = new PGlite();
  await client.exec(migrationSql);
  db = drizzle(client, { schema });
  mocks.db = db;
});

afterEach(async () => {
  await client.close();
});

describe("bacaTrafikLive", () => {
  it("cuplikan ACUAN (dt_ms=0) bukan laju nol — statusnya belum-ada-data", async () => {
    const id = await buatInterface({ ifName: "ether1", label: "Ether 1" });
    await sampel(id, "2026-08-20T10:04:00.000Z", 0, 0, 0);

    const live = await bacaTrafikLive(SEKARANG);
    const i = live.interfaces.find((x) => x.id === id)!;
    expect(i.state).toBe("belum-ada-data");
    expect(i.sampledAt).toBeNull();
  });

  it("laju nol yang JUJUR tetap dilaporkan sebagai ok", async () => {
    // Port mati yang counternya tidak bergerak adalah 0 bps yang benar.
    const id = await buatInterface();
    await sampel(id, "2026-08-20T10:04:00.000Z", 0, 0, 60_000);

    const i = (await bacaTrafikLive(SEKARANG)).interfaces[0];
    expect(i.state).toBe("ok");
    expect(i.rxBps).toBe(0);
  });

  it("utilisasi null bila kapasitas tidak diketahui — bukan 0%", async () => {
    // Bar 0% pada uplink 2,8 Gbps lebih menyesatkan daripada tidak ada bar.
    const id = await buatInterface({ capacityBps: null });
    await sampel(id, "2026-08-20T10:04:00.000Z", 5e8, 1e8, 60_000);
    expect((await bacaTrafikLive(SEKARANG)).interfaces[0].utilizationPercent).toBeNull();
  });

  it("utilisasi dihitung dari arah yang TERBESAR", async () => {
    const id = await buatInterface({ capacityBps: 1e9 });
    await sampel(id, "2026-08-20T10:04:00.000Z", 1e8, 8e8, 60_000);
    expect((await bacaTrafikLive(SEKARANG)).interfaces[0].utilizationPercent).toBe(80);
  });

  it("total uplink hanya menjumlah yang berperan uplink dan punya data", async () => {
    const up = await buatInterface({ role: "uplink", ifName: "sfp1" });
    const situs = await buatInterface({ role: "site", ifName: "vlan100" });
    const upKosong = await buatInterface({ role: "uplink", ifName: "sfp2" });
    await sampel(up, "2026-08-20T10:04:00.000Z", 2.8e9, 2.9e8, 60_000);
    await sampel(situs, "2026-08-20T10:04:00.000Z", 9e8, 1e8, 60_000);
    await sampel(upKosong, "2026-08-20T10:04:00.000Z", 0, 0, 0); // acuan saja

    const live = await bacaTrafikLive(SEKARANG);
    expect(live.totals.uplinkRxBps).toBe(2.8e9);
  });

  it("umur data selalu dilaporkan, dan basi ditandai", async () => {
    // Layar TV yang membeku terlihat persis seperti jaringan yang tenang.
    const id = await buatInterface();
    await sampel(id, "2026-08-20T09:00:00.000Z", 1e6, 1e6, 60_000);
    const live = await bacaTrafikLive(SEKARANG);
    expect(live.ageSeconds).toBe(3900);
    expect(live.stale).toBe(true);
  });

  it("tanpa data sama sekali → stale, bukan diam-diam sehat", async () => {
    await buatInterface();
    const live = await bacaTrafikLive(SEKARANG);
    expect(live.ageSeconds).toBeNull();
    expect(live.stale).toBe(true);
  });

  it("interface yang hilang dari router ditandai", async () => {
    const id = await buatInterface({ missingSince: T("2026-08-20T09:00:00.000Z") });
    await sampel(id, "2026-08-20T10:04:00.000Z", 1e6, 1e6, 60_000);
    expect((await bacaTrafikLive(SEKARANG)).interfaces[0].state).toBe("hilang");
  });
});

describe("bacaDeretTrafik", () => {
  it("cuplikan acuan tidak ikut jadi titik — jurang palsu tiap worker restart", async () => {
    const id = await buatInterface();
    await sampel(id, "2026-08-20T09:00:00.000Z", 5e8, 1e8, 60_000);
    await sampel(id, "2026-08-20T09:01:00.000Z", 0, 0, 0);
    await sampel(id, "2026-08-20T09:02:00.000Z", 5e8, 1e8, 60_000);

    const d = await bacaDeretTrafik(id, 24, SEKARANG);
    expect(d!.points).toHaveLength(2);
    expect(d!.points.every((p) => p.rxBps === 5e8)).toBe(true);
  });

  it("interface tidak dikenal → null, bukan deret kosong yang menyesatkan", async () => {
    expect(await bacaDeretTrafik("tidak-ada", 24, SEKARANG)).toBeNull();
  });

  it("jam di luar batas dijepit, tidak melempar", async () => {
    const id = await buatInterface();
    expect((await bacaDeretTrafik(id, 99_999, SEKARANG))!.hours).toBe(24 * 30);
  });
});
