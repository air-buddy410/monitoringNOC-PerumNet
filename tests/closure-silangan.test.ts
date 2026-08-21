// Closure dan silangan core (Fase 13).
//
// Yang dijaga di sini, berurutan menurut seberapa mahal kalau salah:
//
//   1. LARANGAN MEMBAGI. Satu ujung core masuk hanya boleh punya satu
//      sambungan aktif. Kalau ini bocor, satu feeder bisa "bercabang" di
//      closure biasa tanpa splitter — dan setiap trace yang lewat situ jadi
//      ambigu tanpa ada yang tahu. Ditegakkan index unik, dan ada tes yang
//      menulis langsung ke tabel untuk membuktikannya.
//   2. SEMUA-ATAU-TIDAK. Satu baris bentrok membatalkan seluruh batch.
//      Matriks silangan yang tersimpan separuh terlihat sudah dikerjakan, dan
//      itu lebih berbahaya daripada yang jelas-jelas kosong.
//   3. PRATINJAU DAN COMMIT SEPAKAT. Keduanya memakai fungsi pemeriksa yang
//      sama; ada tes yang menuntut hasilnya identik.
//
// Dua aturan sengaja TIDAK bisa dijaga index dan diuji terpisah: ujung yang
// dipakai sebagai masuk di satu sambungan dan keluar di sambungan lain (dua
// index masing-masing hanya melihat satu kolom), dan ujung yang sudah
// diterminasi ke port (tabel lain).

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/server/rbac", () => ({
  withRole:
    (_r: string[], h: (a: Request, u: unknown, c: unknown) => Promise<Response>) =>
    (request: Request, context: unknown) =>
      h(request, { id: "u1", name: "P", email: "p@c.id", role: "admin" }, context),
}));

import * as schema from "@/db/schema";
import * as authSchema from "@/db/auth-schema";
import { buatKabel, detailKabel, terminasiCore } from "@/server/fiber-store";
import { buatOtb } from "@/server/otb-store";
import {
  buatClosure,
  detailClosure,
  lepasSilangan,
  pasangSilangan,
  periksaBaris,
} from "@/server/closure-store";

const MIGRATION_DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const migrationSql = readdirSync(MIGRATION_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATION_DIR, f), "utf8"))
  .join("\n");

let client: PGlite;
let closureId: string;
let feeder: { id: string; cores: { id: string; coreNumber: number }[] };
let lanjutan: { id: string; cores: { id: string; coreNumber: number }[] };

function d() {
  return mocks.db as ReturnType<typeof drizzle>;
}

/** Core nomor N dari sebuah kabel. */
function core(k: typeof feeder, nomor: number) {
  return k.cores.find((c) => c.coreNumber === nomor)!.id;
}

beforeEach(async () => {
  client = new PGlite();
  await client.exec(migrationSql);
  mocks.db = drizzle(client, { schema: { ...schema, ...authSchema } });

  await d().insert(schema.networkSites).values({ id: "s1", code: "KCC", name: "Kecicang" });
  await d().insert(authSchema.user).values({
    id: "u1", name: "P", email: "p@c.id",
    emailVerified: true, createdAt: new Date(), updatedAt: new Date(),
  });

  const c = await buatClosure({ code: "CL-01", name: "Closure Satu", siteId: "s1" }, "u1");
  if (!c.ok) throw new Error(c.error);
  closureId = c.data.id;

  for (const [kode, simpan] of [["KBL-A", "feeder"], ["KBL-B", "lanjutan"]] as const) {
    const h = await buatKabel({ code: kode, category: "feeder", coreCount: 24 }, "u1");
    if (!h.ok) throw new Error(h.error);
    const detail = await detailKabel(h.data.id);
    const isi = { id: h.data.id, cores: detail!.cores };
    if (simpan === "feeder") feeder = isi;
    else lanjutan = isi;
  }
});

afterEach(async () => {
  await client.close();
});

describe("silangan lurus dan silang", () => {
  it("Core 17 ke Core 17 tersambung, dan ditandai bukan silang", async () => {
    const h = await pasangSilangan(
      closureId,
      [{ inputCoreId: core(feeder, 17), inputCoreEnd: "B", outputCoreId: core(lanjutan, 17), outputCoreEnd: "A" }],
      "sambungan lurus",
      "u1",
    );
    expect(h.ok).toBe(true);

    const detail = await detailClosure(closureId);
    expect(detail!.splices).toHaveLength(1);
    expect(detail!.splices[0].silang).toBe(false);
    expect(detail!.splices[0].inputCoreNumber).toBe(17);
    expect(detail!.splices[0].outputCoreNumber).toBe(17);
  });

  it("Core 17 ke Core 23 tersambung, dan perubahan nomornya tercatat", async () => {
    // Inti PRD §3.1: nomor core BOLEH berubah di closure, dan trace wajib
    // mengikuti nomor yang baru. Kalau ini tidak tercatat, jalur berhenti di
    // closure dan teknisi kembali menelusuri dokumen manual.
    const h = await pasangSilangan(
      closureId,
      [{ inputCoreId: core(feeder, 17), inputCoreEnd: "B", outputCoreId: core(lanjutan, 23), outputCoreEnd: "A" }],
      "silang core",
      "u1",
    );
    expect(h.ok).toBe(true);
    if (h.ok) expect(h.data.verdicts[0].silangNomor).toEqual({ dari: 17, ke: 23 });

    const detail = await detailClosure(closureId);
    expect(detail!.splices[0].silang).toBe(true);
    expect(detail!.splices[0].outputCoreNumber).toBe(23);
  });
});

describe("larangan membagi", () => {
  it("satu ujung masuk tidak boleh punya dua keluaran", async () => {
    await pasangSilangan(
      closureId,
      [{ inputCoreId: core(feeder, 1), inputCoreEnd: "B", outputCoreId: core(lanjutan, 1), outputCoreEnd: "A" }],
      "pertama",
      "u1",
    );
    const h = await pasangSilangan(
      closureId,
      [{ inputCoreId: core(feeder, 1), inputCoreEnd: "B", outputCoreId: core(lanjutan, 2), outputCoreEnd: "A" }],
      "coba bagi",
      "u1",
    );
    expect(h.ok).toBe(false);
    if (!h.ok) {
      expect(h.status).toBe(409);
      // Pesannya harus menyebut jalan keluarnya, bukan cuma menolak.
      expect(h.error).toMatch(/master splitter/i);
    }
  });

  it("membagi dalam SATU batch pun ditolak", async () => {
    const h = await pasangSilangan(
      closureId,
      [
        { inputCoreId: core(feeder, 1), inputCoreEnd: "B", outputCoreId: core(lanjutan, 1), outputCoreEnd: "A" },
        { inputCoreId: core(feeder, 1), inputCoreEnd: "B", outputCoreId: core(lanjutan, 2), outputCoreEnd: "A" },
      ],
      "dua sekaligus",
      "u1",
    );
    expect(h.ok).toBe(false);
    expect(await d().select().from(schema.fiberCoreSplices)).toHaveLength(0);
  });

  it("index unik menolak walau store dilewati", async () => {
    // Kalau `fiber_splice_input_idx` dihapus, tes ini hijau dan larangan
    // membagi hilang tanpa satu pun tes lain merah.
    await d().insert(schema.fiberCoreSplices).values({
      id: "sp1", closureId, inputCoreId: core(feeder, 1), inputCoreEnd: "B",
      outputCoreId: core(lanjutan, 1), outputCoreEnd: "A", reason: "satu",
    });
    await expect(
      d().insert(schema.fiberCoreSplices).values({
        id: "sp2", closureId, inputCoreId: core(feeder, 1), inputCoreEnd: "B",
        outputCoreId: core(lanjutan, 2), outputCoreEnd: "A", reason: "dua",
      }),
    ).rejects.toThrow();
  });

  it("core disambung ke dirinya sendiri ditolak CHECK", async () => {
    await expect(
      d().insert(schema.fiberCoreSplices).values({
        id: "sp1", closureId, inputCoreId: core(feeder, 1), inputCoreEnd: "A",
        outputCoreId: core(feeder, 1), outputCoreEnd: "B", reason: "loop",
      }),
    ).rejects.toThrow();
  });
});

describe("ujung yang sudah dipakai", () => {
  it("ujung keluar yang sudah ditempati ditolak", async () => {
    await pasangSilangan(
      closureId,
      [{ inputCoreId: core(feeder, 1), inputCoreEnd: "B", outputCoreId: core(lanjutan, 5), outputCoreEnd: "A" }],
      "pertama",
      "u1",
    );
    const h = await pasangSilangan(
      closureId,
      [{ inputCoreId: core(feeder, 2), inputCoreEnd: "B", outputCoreId: core(lanjutan, 5), outputCoreEnd: "A" }],
      "kedua",
      "u1",
    );
    expect(h.ok).toBe(false);
  });

  it("ujung yang dipakai sebagai MASUK tidak bisa dipakai sebagai KELUAR", async () => {
    // Dua index unik masing-masing hanya melihat satu kolom, jadi keunikan
    // lintas-kolom TIDAK dijamin database — ini yang menjaganya.
    await pasangSilangan(
      closureId,
      [{ inputCoreId: core(feeder, 3), inputCoreEnd: "B", outputCoreId: core(lanjutan, 3), outputCoreEnd: "A" }],
      "pertama",
      "u1",
    );
    const h = await pasangSilangan(
      closureId,
      [{ inputCoreId: core(lanjutan, 9), inputCoreEnd: "B", outputCoreId: core(feeder, 3), outputCoreEnd: "B" }],
      "pakai ujung yang sama sebagai keluar",
      "u1",
    );
    expect(h.ok).toBe(false);
  });

  it("ujung yang dipakai sebagai KELUAR tidak bisa dipakai sebagai MASUK", async () => {
    // Cermin dari tes di atas, dan bukan pengulangan: yang satu bergantung
    // pada kolom `input_core_id` terekam, yang ini pada `output_core_id`.
    // Ditemukan lewat uji mutasi — menghapus perekaman sisi keluar tidak
    // membuat satu pun tes merah sampai tes ini ada.
    await pasangSilangan(
      closureId,
      [{ inputCoreId: core(feeder, 6), inputCoreEnd: "B", outputCoreId: core(lanjutan, 6), outputCoreEnd: "A" }],
      "pertama",
      "u1",
    );
    const h = await pasangSilangan(
      closureId,
      [{ inputCoreId: core(lanjutan, 6), inputCoreEnd: "A", outputCoreId: core(feeder, 8), outputCoreEnd: "B" }],
      "pakai ujung keluar sebagai masuk",
      "u1",
    );
    expect(h.ok).toBe(false);
    if (!h.ok) expect(h.error).toMatch(/sambungan aktif/i);
  });

  it("ujung yang sudah DITERMINASI ke port tidak bisa disambung", async () => {
    // Terminasi hidup di tabel lain, jadi tidak ada index yang bisa
    // menjaganya bersama tabel ini.
    const o = await buatOtb(
      { code: "OTB-1", name: "OTB", siteId: "s1", connectorType: "LC", trayCount: 1 },
      "u1",
    );
    if (!o.ok) throw new Error(o.error);
    const [port] = await d().select().from(schema.otbPorts).limit(1);
    await terminasiCore(
      { coreId: core(feeder, 4), coreEnd: "A", otbPortId: port.id, reason: "terminasi" },
      "u1",
    );

    const h = await pasangSilangan(
      closureId,
      [{ inputCoreId: core(feeder, 4), inputCoreEnd: "A", outputCoreId: core(lanjutan, 4), outputCoreEnd: "A" }],
      "coba sambung yang sudah terminasi",
      "u1",
    );
    expect(h.ok).toBe(false);
    if (!h.ok) expect(h.error).toMatch(/diterminasi/i);
  });
});

describe("semua atau tidak sama sekali", () => {
  it("satu baris bentrok membatalkan seluruh batch", async () => {
    await pasangSilangan(
      closureId,
      [{ inputCoreId: core(feeder, 10), inputCoreEnd: "B", outputCoreId: core(lanjutan, 10), outputCoreEnd: "A" }],
      "yang sudah ada",
      "u1",
    );

    const h = await pasangSilangan(
      closureId,
      [
        { inputCoreId: core(feeder, 11), inputCoreEnd: "B", outputCoreId: core(lanjutan, 11), outputCoreEnd: "A" },
        { inputCoreId: core(feeder, 12), inputCoreEnd: "B", outputCoreId: core(lanjutan, 12), outputCoreEnd: "A" },
        // Baris ini bentrok dengan yang sudah ada.
        { inputCoreId: core(feeder, 10), inputCoreEnd: "B", outputCoreId: core(lanjutan, 13), outputCoreEnd: "A" },
      ],
      "batch",
      "u1",
    );
    expect(h.ok).toBe(false);
    if (!h.ok) expect(h.error).toMatch(/tidak ada yang disimpan/i);

    // Hanya yang pertama tadi; dua baris sah dalam batch itu ikut batal.
    expect(await d().select().from(schema.fiberCoreSplices)).toHaveLength(1);
  });

  it("batch yang seluruhnya sah tersimpan utuh", async () => {
    const rows = [1, 2, 3, 4].map((n) => ({
      inputCoreId: core(feeder, n), inputCoreEnd: "B" as const,
      outputCoreId: core(lanjutan, n + 10), outputCoreEnd: "A" as const,
    }));
    const h = await pasangSilangan(closureId, rows, "pemasangan awal", "u1");
    expect(h.ok).toBe(true);
    if (h.ok) expect(h.data.dipasang).toBe(4);
    expect(await d().select().from(schema.fiberCoreSplices)).toHaveLength(4);
  });

  it("alasan wajib, dan batch kosong ditolak", async () => {
    const rows = [{ inputCoreId: core(feeder, 1), inputCoreEnd: "B" as const, outputCoreId: core(lanjutan, 1), outputCoreEnd: "A" as const }];
    expect((await pasangSilangan(closureId, rows, "  ", "u1")).ok).toBe(false);
    expect((await pasangSilangan(closureId, [], "ada alasan", "u1")).ok).toBe(false);
  });
});

describe("pratinjau", () => {
  it("pratinjau dan commit memberi hasil yang SAMA", async () => {
    // Kalau keduanya punya jalur validasi sendiri, pratinjau cepat atau
    // lambat menjanjikan sesuatu yang ditolak commit — dan sesudah itu tidak
    // ada yang mempercayainya.
    await pasangSilangan(
      closureId,
      [{ inputCoreId: core(feeder, 7), inputCoreEnd: "B", outputCoreId: core(lanjutan, 7), outputCoreEnd: "A" }],
      "yang sudah ada",
      "u1",
    );

    const rows = [
      { inputCoreId: core(feeder, 8), inputCoreEnd: "B" as const, outputCoreId: core(lanjutan, 8), outputCoreEnd: "A" as const },
      { inputCoreId: core(feeder, 7), inputCoreEnd: "B" as const, outputCoreId: core(lanjutan, 9), outputCoreEnd: "A" as const },
    ];

    const pratinjau = await periksaBaris(closureId, rows);
    expect(pratinjau.verdicts.map((v) => v.ok)).toEqual([true, false]);

    const commit = await pasangSilangan(closureId, rows, "coba", "u1");
    expect(commit.ok).toBe(false);
    // Pratinjau bilang baris 2 yang gagal; commit harus menyebut baris 2 juga.
    if (!commit.ok) expect(commit.error).toMatch(/Baris 2/);
  });

  it("pratinjau tidak menulis apa pun", async () => {
    const rows = [{ inputCoreId: core(feeder, 1), inputCoreEnd: "B" as const, outputCoreId: core(lanjutan, 1), outputCoreEnd: "A" as const }];
    await periksaBaris(closureId, rows);
    expect(await d().select().from(schema.fiberCoreSplices)).toHaveLength(0);
  });

  it("ujung yang dipakai dua kali dalam satu batch ditandai", async () => {
    const rows = [
      { inputCoreId: core(feeder, 1), inputCoreEnd: "B" as const, outputCoreId: core(lanjutan, 1), outputCoreEnd: "A" as const },
      { inputCoreId: core(feeder, 2), inputCoreEnd: "B" as const, outputCoreId: core(lanjutan, 1), outputCoreEnd: "A" as const },
    ];
    const { verdicts } = await periksaBaris(closureId, rows);
    expect(verdicts[0].ok).toBe(true);
    expect(verdicts[1].ok).toBe(false);
    expect(verdicts[1].error).toMatch(/lebih dari sekali/i);
  });
});

describe("melepas silangan", () => {
  async function pasang() {
    const h = await pasangSilangan(
      closureId,
      [{ inputCoreId: core(feeder, 17), inputCoreEnd: "B", outputCoreId: core(lanjutan, 23), outputCoreEnd: "A" }],
      "pemasangan awal",
      "u1",
    );
    if (!h.ok) throw new Error(h.error);
    return h.data.ids[0];
  }

  it("barisnya tidak dihapus, dan ujungnya bisa dipakai lagi", async () => {
    const id = await pasang();
    const h = await lepasSilangan(id, "reroute", "u1");
    expect(h.ok).toBe(true);

    const semua = await d().select().from(schema.fiberCoreSplices);
    expect(semua).toHaveLength(1);
    expect(semua[0].deactivatedAt).not.toBeNull();
    expect(semua[0].deactivatedReason).toBe("reroute");

    const lagi = await pasangSilangan(
      closureId,
      [{ inputCoreId: core(feeder, 17), inputCoreEnd: "B", outputCoreId: core(lanjutan, 5), outputCoreEnd: "A" }],
      "jalur pengganti",
      "u1",
    );
    expect(lagi.ok).toBe(true);

    const aktif = await d().select().from(schema.fiberCoreSplices)
      .where(isNull(schema.fiberCoreSplices.deactivatedAt));
    expect(aktif).toHaveLength(1);
  });

  it("riwayat menampilkan yang sudah dilepas, keadaan sekarang tidak", async () => {
    const id = await pasang();
    await lepasSilangan(id, "dibongkar", "u1");

    expect((await detailClosure(closureId, true))!.splices).toHaveLength(0);
    const riwayat = (await detailClosure(closureId, false))!.splices;
    expect(riwayat).toHaveLength(1);
    expect(riwayat[0].deactivatedReason).toBe("dibongkar");
  });

  it("melepas dua kali ditolak", async () => {
    const id = await pasang();
    await lepasSilangan(id, "sekali", "u1");
    expect((await lepasSilangan(id, "dua kali", "u1")).ok).toBe(false);
  });
});

describe("closure", () => {
  it("tanpa situs dan tanpa koordinat ditolak", async () => {
    const h = await buatClosure({ code: "CL-X" }, "u1");
    expect(h.ok).toBe(false);
    if (!h.ok) expect(h.error).toMatch(/latitude/);
  });

  it("tanpa situs tapi berkoordinat diterima", async () => {
    const h = await buatClosure({ code: "CL-Y", latitude: -8.4, longitude: 115.6 }, "u1");
    expect(h.ok).toBe(true);
  });

  it("closure yang punya silangan tidak bisa dihapus — FK restrict", async () => {
    await pasangSilangan(
      closureId,
      [{ inputCoreId: core(feeder, 1), inputCoreEnd: "B", outputCoreId: core(lanjutan, 1), outputCoreEnd: "A" }],
      "x",
      "u1",
    );
    await expect(
      d().delete(schema.fiberClosures).where(eq(schema.fiberClosures.id, closureId)),
    ).rejects.toThrow();
  });
});
