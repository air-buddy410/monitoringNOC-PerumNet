// Kabel distribusi CONTOH dari ODC/MS ke DP — mengikuti jalan.
//
// Topologinya NYATA: tiap kabel dibuat dari satu hubungan `odps.parent_id`
// yang sudah ada di produksi. Yang contoh adalah kabelnya — jumlah core dan
// jalurnya perkiraan, bukan catatan lapangan.
//
// KENAPA TIDAK ADA TERMINASI:
// Menerminasi core ke port ODP akan memakai port produksi. Di sana 1.692 port
// berstatus terpakai dan 1.687 di antaranya membawa `external_service_id`
// pelanggan; memakai port kosong untuk kabel turunan akan menaikkan
// `usedPorts` tiap ODP dan merusak angka okupansi yang dipakai orang
// memutuskan apakah sebuah ODP masih bisa dijual.
//
// Kabelnya tetap tergambar karena peta menggambar dari `route` tersimpan,
// tanpa perlu jangkar sama sekali.
//
// JALURNYA `perkiraan-jalan`, SELALU:
// Dihitung mesin rute, bukan disusuri orang. Mesin tahu jalan yang ADA, bukan
// jalan tempat kabelnya DIGANTUNG.
//
// PEMAKAIAN:
//   DATABASE_URL=… npx tsx scripts/seed-distribusi-contoh.ts --berkas rute-odp.json
//   … --terapkan   untuk menulis
//   … --hapus --terapkan   untuk membuang seluruhnya

import { readFileSync } from "node:fs";
import { inArray, like } from "drizzle-orm";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const argv = process.argv.slice(2);
const TERAPKAN = argv.includes("--terapkan");
const HAPUS = argv.includes("--hapus");
const BERKAS = argv[argv.indexOf("--berkas") + 1];

const AWALAN = "CONTOH-DST-";
/**
 * Jumlah core per kabel distribusi — ANGKA PERKIRAAN, bukan catatan lapangan.
 * Disebut di `notes` tiap kabel supaya tidak ada yang memakainya untuk
 * merencanakan kapasitas.
 */
const CORE_COUNT = 12;
const CATATAN =
  "Data CONTOH. Hubungannya nyata (dari odps.parent_id), tapi jumlah core dan jalurnya PERKIRAAN — " +
  "jalur dihitung mesin rute, bukan disurvei. Jangan dipakai merencanakan kapasitas.";

interface Rute {
  indukCode: string; anakCode: string;
  indukRole: string; anakRole: string;
  indukSite: string | null; anakSite: string | null;
  jangkarAwal: [number, number];
  jangkarAkhir: [number, number];
  rute: Array<[number, number]>;
  jarakM: number;
}

/** Kode kabel dari pasangan kode ODP; spasi diganti supaya kodenya satu kata. */
function kodeKabel(r: Rute): string {
  const bersih = (x: string) => x.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${AWALAN}${bersih(r.indukCode)}--${bersih(r.anakCode)}`;
}

async function main() {
  const { db } = await import("../src/db");
  const s = await import("../src/db/schema");
  const fiber = await import("../src/server/fiber-store");
  const J = await import("../src/server/jalur-kabel");

  const dimana = process.env.DATABASE_URL ? "PostgreSQL (DATABASE_URL)" : "PGlite lokal";
  console.log(`[distribusi] database: ${dimana}${TERAPKAN ? "" : " — KERING"}`);

  if (HAPUS) {
    const kabel = await db
      .select({ id: s.fiberCableSegments.id })
      .from(s.fiberCableSegments)
      .where(like(s.fiberCableSegments.code, `${AWALAN}%`));
    console.log(`[distribusi] akan menghapus: ${kabel.length} kabel`);
    if (!TERAPKAN) return console.log("[distribusi] tambahkan --terapkan.");
    if (kabel.length) {
      // Tidak ada terminasi yang dibuat skrip ini, tapi dibuang dulu kalau
      // ada — FK ke core sengaja RESTRICT, bukan CASCADE.
      const cores = await db
        .select({ id: s.fiberCores.id })
        .from(s.fiberCores)
        .where(inArray(s.fiberCores.segmentId, kabel.map((k) => k.id)));
      if (cores.length) {
        await db.delete(s.fiberCoreTerminations).where(inArray(s.fiberCoreTerminations.coreId, cores.map((c) => c.id)));
      }
      await db.delete(s.fiberCableSegments).where(inArray(s.fiberCableSegments.id, kabel.map((k) => k.id)));
    }
    return console.log("[distribusi] terhapus.");
  }

  if (!BERKAS || BERKAS.startsWith("--")) {
    console.error("[distribusi] --berkas <rute-odp.json> wajib diisi.");
    process.exitCode = 1;
    return;
  }

  const rute: Rute[] = JSON.parse(readFileSync(BERKAS, "utf8"));
  const sudahAda = await db
    .select({ code: s.fiberCableSegments.code })
    .from(s.fiberCableSegments)
    .where(like(s.fiberCableSegments.code, `${AWALAN}%`));
  if (sudahAda.length > 0) {
    console.error(`[distribusi] ${sudahAda.length} kabel sudah ada. Jalankan --hapus --terapkan dulu.`);
    process.exitCode = 1;
    return;
  }

  // Diperiksa SEBELUM apa pun ditulis. Satu jalur cacat di tengah proses
  // meninggalkan separuh kabel terpasang, dan itu keadaan yang mahal dibereskan.
  const cacat: string[] = [];
  const siap: Array<{ r: Rute; titik: Array<[number, number]>; panjangM: number }> = [];
  for (const r of rute) {
    try {
      const disambung = J.sambungKeJangkar(r.jangkarAwal, r.rute, r.jangkarAkhir);
      const h = J.periksaJalur(disambung);
      siap.push({ r, titik: h.titik, panjangM: h.panjangM });
    } catch (e) {
      cacat.push(`${kodeKabel(r)}: ${(e as Error).message}`);
    }
  }
  if (cacat.length) {
    console.log(`\n[distribusi] ${cacat.length} jalur ditolak:`);
    for (const c of cacat.slice(0, 10)) console.log(`  · ${c}`);
    if (cacat.length > 10) console.log(`  … dan ${cacat.length - 10} lagi`);
  }

  const totalTitik = siap.reduce((n, x) => n + x.titik.length, 0);
  const totalM = siap.reduce((n, x) => n + x.panjangM, 0);
  console.log(
    `\n[distribusi] akan membuat: ${siap.length} kabel × ${CORE_COUNT} core · ` +
      `${totalTitik.toLocaleString("id")} titik jalur · total ${(totalM / 1000).toFixed(1)} km`,
  );
  console.log("[distribusi] TANPA terminasi — port ODP produksi tidak disentuh.");
  if (!TERAPKAN) return console.log("[distribusi] tambahkan --terapkan untuk benar-benar menulis.");

  let dibuat = 0;
  for (const { r, titik, panjangM } of siap) {
    const kode = kodeKabel(r);
    const h = await fiber.buatKabel(
      {
        code: kode,
        name: `${r.indukCode} → ${r.anakCode}`,
        category: "distribution",
        coreCount: CORE_COUNT,
        // `length_m` diisi dari panjang jalur karena kabel ini memang tidak
        // punya sumber lain; kalau kelak ada pengukuran OTDR, itu yang menang.
        lengthM: panjangM,
        siteAId: r.indukSite,
        siteBId: r.anakSite && r.anakSite !== r.indukSite ? r.anakSite : null,
        notes: CATATAN,
      },
      null,
    );
    if (!h.ok) {
      console.log(`  GAGAL ${kode}: ${h.error}`);
      continue;
    }
    await db
      .update(s.fiberCableSegments)
      .set({ route: titik, routeSource: "perkiraan-jalan", updatedAt: new Date() })
      .where(inArray(s.fiberCableSegments.id, [h.data.id]));
    dibuat += 1;
    if (dibuat % 100 === 0) console.log(`  ${dibuat}/${siap.length}…`);
  }
  console.log(`\n[distribusi] ${dibuat} kabel dibuat, semuanya bertanda perkiraan-jalan.`);
}

main()
  .catch((e) => {
    console.error("[distribusi] GAGAL:", e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
