// Memuat sheet "Alokasi Core 144" jadi kabel backbone beserta 144 seratnya.
//
// KENAPA ADA:
// Fase 12–14 berdiri lengkap dengan tesnya, tapi belum pernah bertemu catatan
// lapangan sungguhan. Data contoh berawalan `CONTOH-` sengaja dibuat supaya
// layarnya bisa dilihat; ini yang menggantikannya dengan yang nyata.
//
// KENAPA BERKASNYA DI LUAR REPO:
// `monitoringNOC-PerumNet` adalah repo PUBLIK. Alokasi core backbone memetakan
// tulang punggung jaringan — serat mana menuju ke mana, dan port OLT mana yang
// dilayaninya. Itu bukan daftar pelanggan, tapi juga bukan sesuatu yang perlu
// dibaca siapa pun di internet. Berkasnya tinggal di folder payung, sebelah
// `AKUN-TIM.md`, dan skrip ini menerimanya lewat `--berkas`.
//
// SIFATNYA:
// - Memakai JALUR DOMAIN aplikasi (`buatKabel`), bukan SQL sendiri. Kalau
//   impor ini berhasil, jalur tulis aplikasinya ikut terbukti.
// - KERING secara bawaan. `--terapkan` untuk benar-benar menulis.
// - Kekeliruan di sheet DILAPORKAN, tidak diperbaiki diam-diam. Pengimpor yang
//   membetulkan sendiri catatan lapangan membuat sheet dan database perlahan
//   berbeda tanpa ada yang tahu — sementara yang di lapangan tetap membaca
//   sheetnya.
// - Menolak berjalan kalau kabel dengan kode itu sudah ada, kecuali `--ganti`.
//
// PEMAKAIAN:
//   npx tsx scripts/impor-alokasi-core.ts --berkas ../data-lapangan/alokasi-core-144.csv
//   DATABASE_URL=… npx tsx scripts/impor-alokasi-core.ts --berkas … --terapkan

import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const argv = process.argv.slice(2);
const TERAPKAN = argv.includes("--terapkan");
const GANTI = argv.includes("--ganti");
const BERKAS = argv[argv.indexOf("--berkas") + 1];

/** Kode kabel. Tidak berawalan `CONTOH-` — ini catatan lapangan sungguhan. */
const KODE = process.env.KODE_KABEL ?? "BB-KECICANG-PESAGI-144";
const JUMLAH_CORE = 144;
const SERAT_PER_TABUNG = 12;

function keluarSalah(pesan: string): never {
  console.error(`[impor] ${pesan}`);
  process.exit(1);
}

async function main() {
  if (!BERKAS || BERKAS.startsWith("--")) {
    keluarSalah("--berkas <path CSV> wajib diisi.");
  }

  const { uraiAlokasiCore, catatanCore } = await import("../src/server/impor-alokasi");
  const { db } = await import("../src/db");
  const s = await import("../src/db/schema");
  const fiber = await import("../src/server/fiber-store");

  let csv: string;
  try {
    csv = readFileSync(BERKAS, "utf8");
  } catch (e) {
    keluarSalah(`tidak bisa membaca ${BERKAS}: ${(e as Error).message}`);
  }

  const { baris, masalah } = uraiAlokasiCore(csv, JUMLAH_CORE);
  const dimana = process.env.DATABASE_URL ? "PostgreSQL (DATABASE_URL)" : "PGlite lokal";
  console.log(`[impor] berkas : ${BERKAS}`);
  console.log(`[impor] database: ${dimana}${TERAPKAN ? "" : " — KERING, tidak menulis apa pun"}`);
  console.log(`[impor] terbaca : ${baris.length} serat dari ${JUMLAH_CORE}`);

  // Dilaporkan SEBELUM apa pun ditulis, dan dikelompokkan supaya delapan baris
  // sejenis tidak terbaca sebagai delapan masalah berbeda.
  if (masalah.length > 0) {
    const perJenis = new Map<string, string[]>();
    for (const m of masalah) {
      if (!perJenis.has(m.jenis)) perJenis.set(m.jenis, []);
      perJenis.get(m.jenis)!.push(m.pesan);
    }
    console.log(`\n[impor] ${masalah.length} catatan tentang isi sheet:`);
    for (const [jenis, pesan] of perJenis) {
      console.log(`  ${jenis} (${pesan.length}):`);
      for (const p of pesan) console.log(`    · ${p}`);
    }
    console.log(
      "\n[impor] Tidak ada yang dibetulkan otomatis. Posisi serat diturunkan dari",
    );
    console.log("        FO ID; label sheet tetap disimpan apa adanya di kolom `label`.");
  }

  const fatal = masalah.filter(
    (m) => m.jenis === "fo-id-ganda" || m.jenis === "fo-id-hilang",
  );
  if (fatal.length > 0) {
    keluarSalah(
      `${fatal.length} serat ganda/hilang — kabel tidak dimuat. FO ID harus utuh 1–${JUMLAH_CORE}.`,
    );
  }

  // Memeriksa sheet tidak seharusnya butuh database. Kalau tabelnya belum ada
  // — laptop tanpa migrasi, misalnya — mode kering tetap berguna: yang paling
  // ingin diketahui sebelum memuat adalah apakah SHEETNYA sehat.
  let adaKabel: { id: string } | undefined;
  try {
    [adaKabel] = await db
      .select({ id: s.fiberCableSegments.id })
      .from(s.fiberCableSegments)
      .where(eq(s.fiberCableSegments.code, KODE))
      .limit(1);
  } catch (e) {
    if (TERAPKAN) throw e;
    console.log(
      `\n[impor] database tidak bisa diperiksa (${(e as Error).message.split("\n")[0]}).`,
    );
    console.log("        Mode kering dilanjutkan; pemeriksaan sheet di atas tetap sah.");
  }

  if (adaKabel && !GANTI) {
    keluarSalah(`kabel ${KODE} sudah ada. Tambahkan --ganti untuk memuat ulang.`);
  }

  const terpakai = baris.filter((b) => b.usage || b.service).length;
  console.log(
    `\n[impor] akan membuat: 1 kabel ${KODE} · ${JUMLAH_CORE} serat ` +
      `(${JUMLAH_CORE / SERAT_PER_TABUNG} tabung × ${SERAT_PER_TABUNG}) · ` +
      `${terpakai} serat beralokasi`,
  );

  if (!TERAPKAN) {
    console.log("[impor] tambahkan --terapkan untuk benar-benar menulis.");
    return;
  }

  if (adaKabel) {
    // `onDelete: cascade` pada `fiber_cores` ikut membuang seratnya.
    await db.delete(s.fiberCableSegments).where(eq(s.fiberCableSegments.id, adaKabel.id));
    console.log(`[impor] kabel lama ${KODE} dihapus.`);
  }

  const hasil = await fiber.buatKabel(
    {
      code: KODE,
      name: "Backbone Kecicang–Pesagi (ADSS 144 core)",
      category: "backbone",
      fiberType: "G.652D",
      coreCount: JUMLAH_CORE,
      tubeSize: SERAT_PER_TABUNG,
      purpose: "feeder",
      notes: `Dimuat dari sheet Alokasi Core 144 (${BERKAS}).`,
    },
    null,
  );
  if (!hasil.ok) keluarSalah(`buatKabel gagal: ${hasil.error}`);
  console.log(`[impor] kabel dibuat: ${hasil.data.code} · ${hasil.data.coreCount} serat`);

  let diperbarui = 0;
  for (const b of baris) {
    const catatan = catatanCore(b);
    if (!b.label && !catatan) continue;
    await db
      .update(s.fiberCores)
      .set({ label: b.label || null, notes: catatan, updatedAt: new Date() })
      // `and(...)`, BUKAN `&&`. Dua objek SQL yang di-`&&` mengembalikan yang
      // kedua saja — penyaring segmennya hilang, dan pembaruan ini akan
      // menyentuh serat bernomor sama DI SELURUH KABEL LAIN.
      .where(
        and(
          eq(s.fiberCores.segmentId, hasil.data.id),
          eq(s.fiberCores.coreNumber, b.foId),
        ),
      );
    diperbarui += 1;
  }
  console.log(`[impor] ${diperbarui} serat diberi label dan catatan.`);
}

main()
  .catch((e) => {
    console.error("[impor] GAGAL:", e);
    process.exitCode = 1;
  })
  // `@/db` membuka pool yang tidak pernah ditutup; tanpa ini prosesnya
  // menggantung sesudah selesai.
  .finally(() => process.exit(process.exitCode ?? 0));
