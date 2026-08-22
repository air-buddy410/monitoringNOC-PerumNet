// Penomoran ganda: nomor core se-kabel DAN posisi di dalam tabung.
//
// Catatan lapangan memakai dua penomoran sekaligus. Sheet `Alokasi Core 144`
// menomori tiap serat sebagai FO ID 1–144 se-kabel, DAN sebagai
// "TUBE 5 CORE 3" di dalam tabungnya.
//
// Model yang hanya menyimpan satu di antaranya tidak bisa menolak kesalahan
// yang SUDAH ADA di sheet itu: `TUBE 5 - CORE 5` muncul dua kali, pada FO ID
// 52 dan 53. Karena FO ID-nya berbeda, `core_number` yang unik per segmen
// meloloskannya — dan catatan CRM sendiri menyebut hal itu "seharusnya
// ditolak constraint database".
//
// Tes terakhir di berkas ini adalah kesalahan itu, apa adanya.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));

import * as schema from "@/db/schema";
import * as authSchema from "@/db/auth-schema";
import {
  buatKabel,
  posisiDalamTabung,
  tabungUntuk,
} from "@/server/fiber-store";

const DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const sqlAll = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => readFileSync(path.join(DIR, f), "utf8")).join("\n");

let client: PGlite;
function d() { return mocks.db as ReturnType<typeof drizzle>; }

async function coresOf(code: string) {
  const [k] = await d().select().from(schema.fiberCableSegments)
    .where(eq(schema.fiberCableSegments.code, code));
  return d().select().from(schema.fiberCores)
    .where(eq(schema.fiberCores.segmentId, k.id))
    .orderBy(asc(schema.fiberCores.coreNumber));
}

beforeEach(async () => {
  client = new PGlite();
  await client.exec(sqlAll);
  mocks.db = drizzle(client, { schema: { ...schema, ...authSchema } });
});

afterEach(async () => { await client.close(); });

describe("ADSS 144 core — 12 tabung × 12 serat", () => {
  it("tiap serat dapat nomor tabung dan posisi di dalamnya", async () => {
    const h = await buatKabel(
      { code: "ADSS-144", category: "backbone", coreCount: 144, tubeSize: 12 },
      null,
    );
    expect(h.ok).toBe(true);
    const cores = await coresOf("ADSS-144");
    expect(cores).toHaveLength(144);

    // Serat 1: tabung 1 posisi 1. Serat 13: tabung 2 posisi 1.
    expect(cores[0]).toMatchObject({ coreNumber: 1, tubeNumber: 1, coreInTube: 1 });
    expect(cores[12]).toMatchObject({ coreNumber: 13, tubeNumber: 2, coreInTube: 1 });
    expect(cores[143]).toMatchObject({ coreNumber: 144, tubeNumber: 12, coreInTube: 12 });

    const tabung = new Set(cores.map((c) => c.tubeNumber));
    expect(tabung.size).toBe(12);
  });

  it("warna mengikuti posisi DI DALAM tabung, bukan nomor se-kabel", async () => {
    // Yang tercetak di serat adalah warna posisinya dalam tabung. Serat ke-13
    // adalah serat pertama tabung 2, jadi ia biru lagi — bukan warna ke-13.
    await buatKabel(
      { code: "ADSS-144", category: "backbone", coreCount: 144, tubeSize: 12 },
      null,
    );
    const cores = await coresOf("ADSS-144");
    expect(cores[0].color).toBe("biru");
    expect(cores[11].color).toBe("tosca");
    expect(cores[12].color).toBe("biru");
  });

  it("kabel tanpa tabung tetap sah — tube dan posisinya kosong", async () => {
    // Dropcore dan patch memang tidak bertabung. Mengarang nomor tabung untuk
    // mereka akan membuat constraint di bawah menolak hal yang benar.
    await buatKabel({ code: "DROP-1", category: "dropcore", coreCount: 2 }, null);
    const cores = await coresOf("DROP-1");
    expect(cores[0].tubeNumber).toBeNull();
    expect(cores[0].coreInTube).toBeNull();
  });

  it("tubeSize di luar akal ditolak", async () => {
    for (const n of [0, -1, 200]) {
      const h = await buatKabel(
        { code: `X-${n}`, category: "feeder", coreCount: 24, tubeSize: n },
        null,
      );
      expect(h.ok).toBe(false);
    }
  });

  it("helper tabung konsisten dengan yang tersimpan", async () => {
    expect(tabungUntuk(52, 12)).toBe(5);
    expect(posisiDalamTabung(52, 12)).toBe(4);
    expect(tabungUntuk(53, 12)).toBe(5);
    expect(posisiDalamTabung(53, 12)).toBe(5);
  });
});

describe("kesalahan nyata dari sheet Alokasi Core 144", () => {
  it("TUBE 5 CORE 5 yang muncul DUA KALI ditolak database", async () => {
    // Ini kesalahan yang benar-benar ada di sheet lapangan, tercatat di
    // crm/docs/TEMUAN-DATA-BENTROK.md §4: FO ID 52 dan 53 sama-sama berlabel
    // TUBE 5 - CORE 5; yang satu semestinya CORE 4.
    //
    // FO ID-nya BERBEDA, jadi `core_number` unik per segmen meloloskannya.
    // Yang menolaknya adalah `fiber_cores_tube_pos_idx`.
    await buatKabel({ code: "ADSS-144", category: "backbone", coreCount: 144 }, null);
    const [k] = await d().select().from(schema.fiberCableSegments)
      .where(eq(schema.fiberCableSegments.code, "ADSS-144"));

    await d().update(schema.fiberCores)
      .set({ tubeNumber: 5, coreInTube: 5 })
      .where(eq(schema.fiberCores.coreNumber, 52));

    await expect(
      d().update(schema.fiberCores)
        .set({ tubeNumber: 5, coreInTube: 5 })
        .where(eq(schema.fiberCores.coreNumber, 53)),
    ).rejects.toThrow();

    // Sesudah dikoreksi jadi CORE 4 — sebagaimana mestinya — ia diterima.
    await d().update(schema.fiberCores)
      .set({ tubeNumber: 5, coreInTube: 4 })
      .where(eq(schema.fiberCores.coreNumber, 53));
    const cores = await d().select().from(schema.fiberCores)
      .where(eq(schema.fiberCores.segmentId, k.id));
    expect(cores.filter((c) => c.tubeNumber === 5 && c.coreInTube !== null)).toHaveLength(2);
  });

  it("posisi yang sama di tabung BERBEDA tetap sah", async () => {
    // Tiap tabung punya posisi 1–12 sendiri. Constraint yang terlalu ketat
    // akan menolak seluruh kabel bertabung.
    await buatKabel(
      { code: "ADSS-24", category: "feeder", coreCount: 24, tubeSize: 12 },
      null,
    );
    const cores = await coresOf("ADSS-24");
    const posisiSatu = cores.filter((c) => c.coreInTube === 1);
    expect(posisiSatu).toHaveLength(2);
    expect(posisiSatu.map((c) => c.tubeNumber)).toEqual([1, 2]);
  });

  it("kabel BERBEDA boleh punya TUBE 5 CORE 5 masing-masing", async () => {
    await buatKabel({ code: "A", category: "feeder", coreCount: 144, tubeSize: 12 }, null);
    const h = await buatKabel({ code: "B", category: "feeder", coreCount: 144, tubeSize: 12 }, null);
    expect(h.ok).toBe(true);
  });
});
