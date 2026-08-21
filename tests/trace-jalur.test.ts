// Mesin trace jalur core (Fase 14).
//
// Topologi uji meniru acuan visual: OTB → closure (core 17 jadi core 23) →
// master splitter → dua ODP.
//
//   OTB-1 p1 ─ KBL-A c17 ─┤CL-01├─ KBL-B c23 ─ MS-1 p1
//                                                 ├─ p2 ─ KBL-C c1 ─ ODP-1 p1
//                                                 └─ p3 ─ KBL-C c2 ─ ODP-2 p1
//
// Yang dijaga, berurutan menurut seberapa mahal kalau salah:
//
//   1. TIDAK MENGARANG. Jalur putus harus berkata putus DI TITIK MANA. Jalur
//      karangan lebih berbahaya daripada tidak ada jalur, karena ia dipercaya
//      dan dipakai mengirim teknisi ke tempat yang salah.
//   2. TIDAK MENGGANTUNG. Data yang berputar harus terdeteksi, bukan membuat
//      proses berputar selamanya.
//   3. PANJANG TIDAK DIPALSUKAN. Segmen tanpa panjang terukur tidak boleh
//      dijumlahkan sebagai nol — totalnya akan terlihat pasti padahal
//      separuhnya karangan.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
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
import { buatOtb } from "@/server/otb-store";
import { buatKabel, detailKabel, terminasiCore } from "@/server/fiber-store";
import { buatClosure, pasangSilangan } from "@/server/closure-store";
import { MODEL_RUGI_KONEKTOR_DB, MODEL_RUGI_SAMBUNGAN_DB, telusuri } from "@/server/trace-store";

const MIGRATION_DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const migrationSql = readdirSync(MIGRATION_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATION_DIR, f), "utf8"))
  .join("\n");

let client: PGlite;
let portOtb: string[];
let kabel: Record<string, { id: string; cores: { id: string; coreNumber: number }[] }>;
let closureId: string;

function d() {
  return mocks.db as ReturnType<typeof drizzle>;
}
function core(kode: string, nomor: number) {
  return kabel[kode].cores.find((c) => c.coreNumber === nomor)!.id;
}

async function buat(kode: string, kategori: "feeder" | "distribution", jumlah: number, panjangM: number | null) {
  const h = await buatKabel({ code: kode, category: kategori, coreCount: jumlah, lengthM: panjangM }, "u1");
  if (!h.ok) throw new Error(h.error);
  const detail = await detailKabel(h.data.id);
  kabel[kode] = { id: h.data.id, cores: detail!.cores };
}

/** Merangkai jalur lengkap OTB → closure → MS → dua ODP. */
async function rangkaiJalurLengkap() {
  // OTB p1 → KBL-A core 17 ujung A
  await terminasiCore({ coreId: core("KBL-A", 17), coreEnd: "A", otbPortId: portOtb[0], reason: "feeder" }, "u1");
  // KBL-A core 17 ujung B ─silang→ KBL-B core 23 ujung A
  await pasangSilangan(
    closureId,
    [{ inputCoreId: core("KBL-A", 17), inputCoreEnd: "B", outputCoreId: core("KBL-B", 23), outputCoreEnd: "A" }],
    "silang core",
    "u1",
  );
  // KBL-B core 23 ujung B → MS-1 port 1 (input splitter)
  await terminasiCore({ coreId: core("KBL-B", 23), coreEnd: "B", odpPortId: "ms-p1", reason: "input MS" }, "u1");
  // Keluaran MS → KBL-C core 1 & 2 → ODP-1 dan ODP-2
  await terminasiCore({ coreId: core("KBL-C", 1), coreEnd: "A", odpPortId: "ms-p2", reason: "keluaran 1" }, "u1");
  await terminasiCore({ coreId: core("KBL-C", 1), coreEnd: "B", odpPortId: "odp1-p1", reason: "ke ODP-1" }, "u1");
  await terminasiCore({ coreId: core("KBL-C", 2), coreEnd: "A", odpPortId: "ms-p3", reason: "keluaran 2" }, "u1");
  await terminasiCore({ coreId: core("KBL-C", 2), coreEnd: "B", odpPortId: "odp2-p1", reason: "ke ODP-2" }, "u1");
}

beforeEach(async () => {
  client = new PGlite();
  await client.exec(migrationSql);
  mocks.db = drizzle(client, { schema: { ...schema, ...authSchema } });
  kabel = {};

  await d().insert(schema.networkSites).values({ id: "s1", code: "KCC", name: "Kecicang" });
  await d().insert(authSchema.user).values({
    id: "u1", name: "P", email: "p@c.id",
    emailVerified: true, createdAt: new Date(), updatedAt: new Date(),
  });

  const o = await buatOtb({ code: "OTB-1", name: "OTB Satu", siteId: "s1", connectorType: "LC", trayCount: 1 }, "u1");
  if (!o.ok) throw new Error(o.error);
  const rows = await d().select({ id: schema.otbPorts.id }).from(schema.otbPorts)
    .orderBy(schema.otbPorts.globalPortNumber);
  portOtb = rows.map((r) => r.id);

  const c = await buatClosure({ code: "CL-01", siteId: "s1" }, "u1");
  if (!c.ok) throw new Error(c.error);
  closureId = c.data.id;

  await buat("KBL-A", "feeder", 24, 850);
  await buat("KBL-B", "feeder", 24, 1100);
  await buat("KBL-C", "distribution", 8, 350);

  await d().insert(schema.odps).values([
    { id: "ms1", code: "MS-1", name: "MS Satu", role: "MS", capacity: 8 },
    { id: "odp1", code: "ODP-1", name: "ODP Satu", role: "ODP", capacity: 8 },
    { id: "odp2", code: "ODP-2", name: "ODP Dua", role: "ODP", capacity: 8 },
  ]);
  await d().insert(schema.odpPorts).values([
    { id: "ms-p1", odpId: "ms1", portNumber: 1 },
    { id: "ms-p2", odpId: "ms1", portNumber: 2 },
    { id: "ms-p3", odpId: "ms1", portNumber: 3 },
    { id: "odp1-p1", odpId: "odp1", portNumber: 1 },
    { id: "odp2-p1", odpId: "odp2", portNumber: 1 },
  ]);
});

afterEach(async () => {
  await client.close();
});

describe("jalur lengkap", () => {
  it("dari port OTB sampai dua ODP, lewat closure dan splitter", async () => {
    await rangkaiJalurLengkap();
    const h = await telusuri({ jenis: "otbPort", id: portOtb[0] });
    expect(h).not.toBeNull();
    expect(h!.ringkas).toMatchObject({ total: 2, lengkap: 2, bermasalah: 0 });

    const ujung = h!.jalur.map((j) => j.langkah.at(-1)!.detail.odpCode).sort();
    expect(ujung).toEqual(["ODP-1", "ODP-2"]);
    expect(h!.jalur.every((j) => j.status === "LENGKAP")).toBe(true);
  });

  it("perubahan nomor core di closure tercatat di langkahnya", async () => {
    // Core 17 masuk, core 23 keluar. Inilah yang paling sering luput dicatat
    // manual, dan alasan seluruh modul ini ada.
    await rangkaiJalurLengkap();
    const h = await telusuri({ jenis: "otbPort", id: portOtb[0] });
    const silangan = h!.jalur[0].langkah.find((l) => l.jenis === "SILANGAN")!;
    expect(silangan.detail).toMatchObject({ dariCoreNumber: 17, keCoreNumber: 23, silang: true });
    expect(silangan.label).toContain("core 17 → core 23");
  });

  it("splitter ditandai SPLITTER, bukan dianggap ODP biasa", async () => {
    await rangkaiJalurLengkap();
    const h = await telusuri({ jenis: "otbPort", id: portOtb[0] });
    const jenis = h!.jalur[0].langkah.map((l) => l.jenis);
    expect(jenis).toContain("SPLITTER");
    // Pembagian di master splitter itu SAH — bukan dilaporkan sebagai masalah.
    expect(h!.ringkas.bermasalah).toBe(0);
  });

  it("telusur balik dari ODP mencapai OTB", async () => {
    await rangkaiJalurLengkap();
    const h = await telusuri({ jenis: "odpPort", id: "odp1-p1" });
    expect(h!.jalur).toHaveLength(1);
    expect(h!.jalur[0].status).toBe("LENGKAP");
    const akhir = h!.jalur[0].langkah.at(-1)!;
    expect(akhir.jenis).toBe("PORT_OTB");
    expect(akhir.detail.otbCode).toBe("OTB-1");
  });

  it("tidak membocorkan identitas pelanggan", async () => {
    await rangkaiJalurLengkap();
    await d().update(schema.odpPorts)
      .set({ externalServiceId: "SRV-123" })
      .where(eq(schema.odpPorts.id, "odp1-p1"));
    const h = await telusuri({ jenis: "otbPort", id: portOtb[0] });
    const teks = JSON.stringify(h);
    for (const terlarang of ["pppoe", "username", "customerName", "alamat", "@"]) {
      expect(teks.toLowerCase()).not.toContain(terlarang.toLowerCase());
    }
    // ID layanan di sistem lain BOLEH — itu bukan identitas orang.
    expect(teks).toContain("SRV-123");
  });
});

describe("panjang dan rugi optik", () => {
  it("menjumlahkan panjang tiap segmen yang dilewati", async () => {
    await rangkaiJalurLengkap();
    const h = await telusuri({ jenis: "otbPort", id: portOtb[0] });
    // KBL-A 850 + KBL-B 1100 + KBL-C 350 = 2300.
    for (const j of h!.jalur) {
      expect(j.ringkas.segmenUnik).toBe(3);
      expect(j.ringkas.segmenBerulang).toBe(0);
      expect(j.ringkas.panjangM).toBe(2300);
      expect(j.ringkas.panjangLengkap).toBe(true);
    }
  });

  it("kabel yang dilewati bolak-balik dihitung DUA kali, dan ditandai", async () => {
    // Keluar lewat core 3, kembali lewat core 4 pada kabel yang sama. Bukan
    // loop — dua core berbeda — dan jaraknya memang dua kali panjang kabel.
    // Menghitungnya sekali akan melaporkan jarak yang terlalu pendek, dan
    // angka itu dipakai menakar jarak-ke-gangguan di OTDR.
    await terminasiCore({ coreId: core("KBL-A", 3), coreEnd: "A", otbPortId: portOtb[8], reason: "x" }, "u1");
    await pasangSilangan(
      closureId,
      [
        { inputCoreId: core("KBL-A", 3), inputCoreEnd: "B", outputCoreId: core("KBL-B", 3), outputCoreEnd: "A" },
        { inputCoreId: core("KBL-B", 3), inputCoreEnd: "B", outputCoreId: core("KBL-A", 4), outputCoreEnd: "B" },
      ],
      "bolak-balik",
      "u1",
    );
    const h = await telusuri({ jenis: "otbPort", id: portOtb[8] });
    const j = h!.jalur[0];
    // KBL-A 850 + KBL-B 1100 + KBL-A 850 lagi = 2800.
    expect(j.ringkas.panjangM).toBe(2800);
    expect(j.ringkas.segmenUnik).toBe(2);
    expect(j.ringkas.segmenBerulang).toBe(1);
  });

  it("segmen tanpa panjang terukur TIDAK dijumlahkan sebagai nol", async () => {
    // Kalau null diperlakukan 0, totalnya terlihat pasti padahal separuhnya
    // tidak diketahui — pelajaran yang sama dengan averageUptime di laporan.
    await d().update(schema.fiberCableSegments).set({ lengthM: null })
      .where(eq(schema.fiberCableSegments.id, kabel["KBL-B"].id));
    await rangkaiJalurLengkap();
    const h = await telusuri({ jenis: "otbPort", id: portOtb[0] });
    const j = h!.jalur[0];
    expect(j.ringkas.panjangLengkap).toBe(false);
    // 850 + 350 saja; 1100 hilang karena memang tidak diketahui.
    expect(j.ringkas.panjangM).toBe(1200);
  });

  it("estimasi rugi menjumlahkan model, dan mengaku memakai model", async () => {
    await rangkaiJalurLengkap();
    const h = await telusuri({ jenis: "otbPort", id: portOtb[0] });
    const j = h!.jalur[0];
    // 4 konektor (port OTB, MS input, keluaran MS, port ODP) + 1 sambungan.
    const harusnya = 4 * MODEL_RUGI_KONEKTOR_DB + 1 * MODEL_RUGI_SAMBUNGAN_DB;
    expect(j.ringkas.estimasiLossDb).toBeCloseTo(harusnya, 2);
    expect(j.ringkas.sambunganPakaiModel).toBe(5);
  });

  it("rugi sambungan yang tersimpan dipakai apa adanya, dan ditandai bukan model", async () => {
    await terminasiCore({ coreId: core("KBL-A", 1), coreEnd: "A", otbPortId: portOtb[1], reason: "x" }, "u1");
    await pasangSilangan(
      closureId,
      [{ inputCoreId: core("KBL-A", 1), inputCoreEnd: "B", outputCoreId: core("KBL-B", 1), outputCoreEnd: "A", estimatedLossDb: 0.45 }],
      "sambungan diukur perencana",
      "u1",
    );
    const h = await telusuri({ jenis: "otbPort", id: portOtb[1] });
    const silangan = h!.jalur[0].langkah.find((l) => l.jenis === "SILANGAN")!;
    expect(silangan.detail).toMatchObject({ estimasiRugiDb: 0.45, rugiDariModel: false });
  });
});

describe("diagnosis, bukan karangan", () => {
  it("ujung core yang belum tersambung berkata UJUNG_JALUR, dan menyebut di mana", async () => {
    await terminasiCore({ coreId: core("KBL-A", 5), coreEnd: "A", otbPortId: portOtb[2], reason: "x" }, "u1");
    const h = await telusuri({ jenis: "otbPort", id: portOtb[2] });
    expect(h!.jalur[0].status).toBe("UJUNG_JALUR");
    expect(h!.jalur[0].diagnosis).toContain("KBL-A");
    expect(h!.jalur[0].diagnosis).toContain("core 5");
  });

  it("port yang belum diterminasi berkata UJUNG_JALUR, bukan jalur kosong", async () => {
    const h = await telusuri({ jenis: "otbPort", id: portOtb[3] });
    expect(h!.jalur[0].status).toBe("UJUNG_JALUR");
    expect(h!.jalur[0].diagnosis).toMatch(/belum diterminasi/i);
  });

  it("core rusak menghentikan jalur dengan sebab yang jelas", async () => {
    await terminasiCore({ coreId: core("KBL-A", 6), coreEnd: "A", otbPortId: portOtb[4], reason: "x" }, "u1");
    await d().update(schema.fiberCores).set({ status: "rusak" })
      .where(eq(schema.fiberCores.id, core("KBL-A", 6)));
    const h = await telusuri({ jenis: "otbPort", id: portOtb[4] });
    expect(h!.jalur[0].status).toBe("JALUR_PUTUS");
    expect(h!.jalur[0].diagnosis).toMatch(/rusak/);
  });

  it("terminasi DAN silangan pada ujung yang sama dilaporkan AMBIGU", async () => {
    // Mustahil secara fisik. Store menolaknya, tapi database tidak bisa —
    // jadi trace harus mengenalinya, bukan diam-diam memilih salah satu.
    await terminasiCore({ coreId: core("KBL-A", 7), coreEnd: "A", otbPortId: portOtb[5], reason: "x" }, "u1");
    await terminasiCore({ coreId: core("KBL-A", 7), coreEnd: "B", otbPortId: portOtb[6], reason: "y" }, "u1");
    await d().insert(schema.fiberCoreSplices).values({
      id: "sp-ambigu", closureId,
      inputCoreId: core("KBL-A", 7), inputCoreEnd: "B",
      outputCoreId: core("KBL-B", 7), outputCoreEnd: "A",
      reason: "ditulis langsung",
    });
    const h = await telusuri({ jenis: "otbPort", id: portOtb[5] });
    expect(h!.jalur[0].status).toBe("AMBIGU");
    expect(h!.jalur[0].diagnosis).toMatch(/terminasi DAN silangan/i);
    expect(h!.ringkas.bermasalah).toBe(1);
  });

  it("jalur yang berputar terdeteksi dan tidak menggantung", async () => {
    // KBL-A c9 B → KBL-B c9 A, lalu KBL-B c9 B → KBL-A c9 A. Melingkar.
    await pasangSilangan(
      closureId,
      [
        { inputCoreId: core("KBL-A", 9), inputCoreEnd: "B", outputCoreId: core("KBL-B", 9), outputCoreEnd: "A" },
        { inputCoreId: core("KBL-B", 9), inputCoreEnd: "B", outputCoreId: core("KBL-A", 9), outputCoreEnd: "A" },
      ],
      "loop buatan",
      "u1",
    );
    const mulai = Date.now();
    const h = await telusuri({ jenis: "coreEnd", coreId: core("KBL-A", 9), ujung: "A" });
    expect(Date.now() - mulai).toBeLessThan(5000);
    expect(h!.jalur[0].status).toBe("BERPUTAR");
    expect(h!.jalur[0].diagnosis).toMatch(/berputar/i);
  });

  it("splitter tanpa keluaran terterminasi berkata begitu, bukan LENGKAP", async () => {
    await terminasiCore({ coreId: core("KBL-A", 11), coreEnd: "A", otbPortId: portOtb[7], reason: "x" }, "u1");
    await terminasiCore({ coreId: core("KBL-A", 11), coreEnd: "B", odpPortId: "ms-p1", reason: "input MS" }, "u1");
    const h = await telusuri({ jenis: "otbPort", id: portOtb[7] });
    expect(h!.jalur[0].status).toBe("UJUNG_JALUR");
    expect(h!.jalur[0].diagnosis).toMatch(/MS-1/);
    expect(h!.jalur[0].diagnosis).toMatch(/keluaran/i);
  });

  it("cabang yang putus tidak menghapus cabang yang lengkap", async () => {
    // Dua-duanya kenyataan, dan operator harus melihat keduanya.
    await rangkaiJalurLengkap();
    await d().update(schema.fiberCores).set({ status: "rusak" })
      .where(eq(schema.fiberCores.id, core("KBL-C", 2)));
    const h = await telusuri({ jenis: "otbPort", id: portOtb[0] });
    expect(h!.ringkas.total).toBe(2);
    expect(h!.ringkas.lengkap).toBe(1);
    expect(h!.ringkas.bermasalah).toBe(1);
  });

  it("master splitter menolak input feeder kedua", async () => {
    // Mesin trace membedakan input dari output SEMATA dari peruntukan core.
    // Dua feeder membuat pembedaan itu ambigu, jadi aturannya ditegakkan
    // saat terminasi — bukan diasumsikan diam-diam oleh trace.
    await terminasiCore({ coreId: core("KBL-A", 20), coreEnd: "A", odpPortId: "ms-p1", reason: "input" }, "u1");
    const h = await terminasiCore(
      { coreId: core("KBL-B", 20), coreEnd: "A", odpPortId: "ms-p2", reason: "input kedua" },
      "u1",
    );
    expect(h.ok).toBe(false);
    if (!h.ok) {
      expect(h.status).toBe(409);
      expect(h.error).toMatch(/satu input/i);
    }
  });

  it("telusur balik tidak menyeberang ke ODP tetangga lewat splitter", async () => {
    // Cahaya dari ODP-1 naik ke input splitter, TIDAK menyeberang ke ODP-2.
    // Tanpa penyaringan arah, trace akan menghasilkan jalur yang tidak
    // pernah ada — dan itu jenis karangan yang paling meyakinkan.
    await rangkaiJalurLengkap();
    const h = await telusuri({ jenis: "odpPort", id: "odp1-p1" });
    expect(h!.jalur).toHaveLength(1);
    // Statusnya HARUS ikut diperiksa. Tanpa ini tes lolos untuk alasan yang
    // salah: penyaringan arah yang rusak menghasilkan AMBIGU — juga satu
    // jalur, juga tanpa ODP-2 — dan bug-nya lewat begitu saja.
    expect(h!.jalur[0].status).toBe("LENGKAP");
    expect(h!.jalur[0].langkah.at(-1)!.detail.otbCode).toBe("OTB-1");
    const kode = h!.jalur[0].langkah.map((l) => l.detail.odpCode).filter(Boolean);
    expect(kode).not.toContain("ODP-2");
  });

  it("titik awal yang tidak ada mengembalikan null", async () => {
    expect(await telusuri({ jenis: "otbPort", id: "entah" })).toBeNull();
    expect(await telusuri({ jenis: "odpPort", id: "entah" })).toBeNull();
  });
});
