// Topologi fiber CONTOH — supaya layar OTB, kabel, closure, dan trace punya
// isi sebelum data lapangan sungguhan masuk.
//
// KENAPA ADA:
// Fase 11–14 berdiri lengkap dengan 564 tes, tapi produksi masih 0 OTB,
// 0 kabel, 0 closure. Enam layar belum pernah dilihat berisi. Skrip ini
// merakit satu jalur utuh — OTB → kabel → closure → master splitter → dua ODP
// — supaya seluruh rantai bisa diklik dan diperiksa orang.
//
// KENAPA SETIAP KODE BERAWALAN `CONTOH-`:
// Data contoh yang tidak bisa dibedakan dari catatan lapangan akan dibaca
// sebagai kabel yang benar-benar terpasang, dan suatu hari ada teknisi
// dikirim ke closure yang tidak ada. Awalan itu satu-satunya yang
// memisahkannya, dan seluruh keamanan `--hapus` bergantung padanya.
//
// Ini pelajaran yang sama dengan laporan SLA yang dulu menanam angka karangan
// ke produksi: yang berbahaya bukan datanya palsu, melainkan tidak ada yang
// bisa tahu bahwa ia palsu.
//
// SIFATNYA:
// - Memakai JALUR DOMAIN aplikasi (`buatOtb`, `buatKabel`, `terminasiCore`,
//   `pasangSilangan`), bukan SQL sendiri. Kalau seed ini berhasil, jalur tulis
//   aplikasinya ikut terbukti — termasuk seluruh aturan okupansinya.
// - Menolak berjalan kalau data contoh sudah ada. Jalankan `--hapus` dulu.
// - `--hapus` HANYA menyentuh baris berawalan `CONTOH-`.
//
// PEMAKAIAN:
//   DATABASE_URL=… npx tsx scripts/seed-fiber-contoh.ts            (kering)
//   DATABASE_URL=… npx tsx scripts/seed-fiber-contoh.ts --terapkan
//   DATABASE_URL=… npx tsx scripts/seed-fiber-contoh.ts --hapus --terapkan

import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const TERAPKAN = process.argv.includes("--terapkan");
const HAPUS = process.argv.includes("--hapus");

async function main() {
  const { db } = await import("../src/db");
  const s = await import("../src/db/schema");
  const otbStore = await import("../src/server/otb-store");
  const fiber = await import("../src/server/fiber-store");
  const closure = await import("../src/server/closure-store");
  const L = await import("./seed-fiber-contoh-lib");

  const dimana = process.env.DATABASE_URL ? "PostgreSQL (DATABASE_URL)" : "PGlite lokal";
  console.log(`[contoh] database: ${dimana}${TERAPKAN ? "" : " — KERING, tidak menulis apa pun"}`);

  const kabelAda = await db.select({ id: s.fiberCableSegments.id, code: s.fiberCableSegments.code })
    .from(s.fiberCableSegments).where(like(s.fiberCableSegments.code, `${L.AWALAN}%`));
  const otbAda = await db.select({ id: s.otb.id }).from(s.otb).where(like(s.otb.code, `${L.AWALAN}%`));
  const closureAda = await db.select({ id: s.fiberClosures.id }).from(s.fiberClosures)
    .where(like(s.fiberClosures.code, `${L.AWALAN}%`));
  const odpAda = await db.select({ id: s.odps.id }).from(s.odps).where(like(s.odps.code, `${L.AWALAN}%`));

  if (HAPUS) {
    const jml = kabelAda.length + otbAda.length + closureAda.length + odpAda.length;
    console.log(`[contoh] akan menghapus: ${otbAda.length} OTB, ${kabelAda.length} kabel, ${closureAda.length} closure, ${odpAda.length} ODP/MS`);
    if (jml === 0) return console.log("[contoh] tidak ada data contoh. Selesai.");
    if (!TERAPKAN) return console.log("[contoh] tambahkan --terapkan untuk benar-benar menghapus.");

    const coreIds = kabelAda.length
      ? (await db.select({ id: s.fiberCores.id }).from(s.fiberCores)
          .where(inArray(s.fiberCores.segmentId, kabelAda.map((k) => k.id)))).map((c) => c.id)
      : [];
    // Urutan penting: silangan dan terminasi memakai FK `restrict`, jadi ia
    // harus pergi lebih dulu — dan itu memang perlindungan yang kita pasang.
    if (coreIds.length) {
      await db.delete(s.fiberCoreSplices).where(inArray(s.fiberCoreSplices.inputCoreId, coreIds));
      await db.delete(s.fiberCoreSplices).where(inArray(s.fiberCoreSplices.outputCoreId, coreIds));
      await db.delete(s.fiberCoreTerminations).where(inArray(s.fiberCoreTerminations.coreId, coreIds));
    }
    if (kabelAda.length) await db.delete(s.fiberCableSegments).where(inArray(s.fiberCableSegments.id, kabelAda.map((k) => k.id)));
    if (closureAda.length) await db.delete(s.fiberClosures).where(inArray(s.fiberClosures.id, closureAda.map((c) => c.id)));
    if (otbAda.length) await db.delete(s.otb).where(inArray(s.otb.id, otbAda.map((o) => o.id)));
    if (odpAda.length) await db.delete(s.odps).where(inArray(s.odps.id, odpAda.map((o) => o.id)));
    console.log("[contoh] terhapus.");
    return;
  }

  if (kabelAda.length || otbAda.length || closureAda.length || odpAda.length) {
    console.error("[contoh] data contoh sudah ada. Jalankan --hapus --terapkan dulu; skrip ini tidak menimpa.");
    process.exitCode = 1;
    return;
  }

  console.log(`[contoh] akan membuat: 1 OTB (${L.OTB.trayCount}×${L.OTB.portsPerTray} port), ${L.KABEL.length} kabel, 1 closure, 1 master splitter, ${L.ODP.length} ODP`);
  console.log(`[contoh] jalur: OTB port ${L.JALUR.otbPortGlobal} → core ${L.JALUR.coreFeederMasuk} → closure → core ${L.JALUR.coreFeederKeluar} → MS → ${L.ODP.length} ODP`);
  if (!TERAPKAN) return console.log("[contoh] tambahkan --terapkan untuk benar-benar menulis.");

  const aktor = null;

  const hOtb = await otbStore.buatOtb({
    code: L.OTB.code, name: L.OTB.name, connectorType: L.OTB.connectorType,
    polish: L.OTB.polish, trayCount: L.OTB.trayCount, portsPerTray: L.OTB.portsPerTray,
    latitude: -8.4498, longitude: 115.5987, notes: L.CATATAN,
  }, aktor);
  if (!hOtb.ok) throw new Error(`OTB: ${hOtb.error}`);

  const kabelId: Record<string, string> = {};
  for (const k of L.KABEL) {
    const h = await fiber.buatKabel({
      code: k.code, category: k.category, coreCount: k.coreCount,
      lengthM: k.lengthM, notes: L.CATATAN,
    }, aktor);
    if (!h.ok) throw new Error(`kabel ${k.code}: ${h.error}`);
    kabelId[k.code] = h.data.id;
    // Nomor tabung diisi sesudahnya — bentuk yang sama dengan sheet lapangan,
    // yang menomori core per tabung, bukan hanya berurut se-kabel.
    const cores = await db.select().from(s.fiberCores).where(eq(s.fiberCores.segmentId, h.data.id));
    for (const c of cores) {
      await db.update(s.fiberCores)
        .set({ tubeNumber: L.tabungUntuk(c.coreNumber, k.tubeSize) })
        .where(eq(s.fiberCores.id, c.id));
    }
  }

  const hCl = await closure.buatClosure({
    code: L.CLOSURE.code, name: L.CLOSURE.name,
    latitude: L.CLOSURE.latitude, longitude: L.CLOSURE.longitude, notes: L.CATATAN,
  }, aktor);
  if (!hCl.ok) throw new Error(`closure: ${hCl.error}`);

  // ODP dan master splitter dibuat langsung — keduanya tabel lama tanpa store
  // tersendiri. Portnya dibuat sekaligus, sama seperti POST /ftth/odps.
  const msId = randomUUID();
  await db.insert(s.odps).values({ id: msId, code: L.SPLITTER.code, name: L.SPLITTER.name, role: "MS", capacity: L.SPLITTER.capacity, status: "ACTIVE", latitude: L.CLOSURE.latitude, longitude: L.CLOSURE.longitude });
  await db.insert(s.odpPorts).values(Array.from({ length: L.SPLITTER.capacity }, (_, i) => ({ id: randomUUID(), odpId: msId, portNumber: i + 1, notes: L.CATATAN })));
  const odpId: string[] = [];
  for (const o of L.ODP) {
    const id = randomUUID();
    odpId.push(id);
    await db.insert(s.odps).values({ id, code: o.code, name: o.name, role: "ODP", capacity: o.capacity, status: "ACTIVE", parentId: msId, latitude: L.CLOSURE.latitude, longitude: L.CLOSURE.longitude });
    await db.insert(s.odpPorts).values(Array.from({ length: o.capacity }, (_, i) => ({ id: randomUUID(), odpId: id, portNumber: i + 1, notes: L.CATATAN })));
  }

  const core = async (kode: string, nomor: number) => {
    const [c] = await db.select().from(s.fiberCores)
      .where(and(eq(s.fiberCores.segmentId, kabelId[kode]), eq(s.fiberCores.coreNumber, nomor)));
    return c.id;
  };
  const portOdp = async (odp: string, nomor: number) => {
    const [p] = await db.select().from(s.odpPorts)
      .where(and(eq(s.odpPorts.odpId, odp), eq(s.odpPorts.portNumber, nomor)));
    return p.id;
  };
  const [portOtb] = await db.select().from(s.otbPorts)
    .where(and(eq(s.otbPorts.otbId, hOtb.data.id), eq(s.otbPorts.globalPortNumber, L.JALUR.otbPortGlobal)));

  const A = L.KABEL[0].code, B = L.KABEL[1].code, C = L.KABEL[2].code;
  const alasan = "Perakitan topologi contoh";

  const langkah: Array<[string, Promise<{ ok: boolean; error?: string }>]> = [];
  const t = (label: string, p: Promise<{ ok: boolean } | { ok: false; error: string }>) =>
    langkah.push([label, p as Promise<{ ok: boolean; error?: string }>]);

  t("OTB port → feeder-01", fiber.terminasiCore({ coreId: await core(A, L.JALUR.coreFeederMasuk), coreEnd: "A", otbPortId: portOtb.id, reason: alasan }, aktor));
  for (const [, p] of langkah.splice(0)) { const r = await p; if (!r.ok) throw new Error(r.error); }

  const hSp = await closure.pasangSilangan(hCl.data.id, [{
    inputCoreId: await core(A, L.JALUR.coreFeederMasuk), inputCoreEnd: "B",
    outputCoreId: await core(B, L.JALUR.coreFeederKeluar), outputCoreEnd: "A",
  }], "Silang core di closure contoh", aktor);
  if (!hSp.ok) throw new Error(`silangan: ${hSp.error}`);

  const pasang = async (label: string, arg: Parameters<typeof fiber.terminasiCore>[0]) => {
    const r = await fiber.terminasiCore(arg, aktor);
    if (!r.ok) throw new Error(`${label}: ${r.error}`);
  };
  await pasang("feeder-02 → MS input", { coreId: await core(B, L.JALUR.coreFeederKeluar), coreEnd: "B", odpPortId: await portOdp(msId, 1), reason: alasan });
  for (const [i, nomorCore] of L.JALUR.coreDistribusi.entries()) {
    await pasang(`MS keluaran ${i + 1}`, { coreId: await core(C, nomorCore), coreEnd: "A", odpPortId: await portOdp(msId, i + 2), reason: alasan });
    await pasang(`ODP ${i + 1}`, { coreId: await core(C, nomorCore), coreEnd: "B", odpPortId: await portOdp(odpId[i], 1), reason: alasan });
  }

  console.log("[contoh] selesai. Buka /ftth/otb dan tekan Trace pada port 1.");
}

main()
  .catch((e) => {
    console.error("[contoh] gagal:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  // Keluar eksplisit: `@/db` membuka Pool (atau instance PGlite) dan tidak
  // pernah menutupnya, jadi tanpa ini proses menggantung selamanya sesudah
  // pekerjaannya selesai — dan skrip yang tidak pernah selesai terlihat persis
  // seperti skrip yang macet.
  .finally(() => process.exit(process.exitCode ?? 0));
