// Memasang jalur (deret titik) pada satu kabel, dari GeoJSON atau GPX.
//
// Kabel MENGIKUTI JALAN. Sampai jalurnya dipasang, peta hanya bisa menarik
// garis lurus antar-jangkar — jelas-jelas skematik, dan justru kejelasannya
// yang membuatnya aman.
//
// `--sumber` WAJIB diisi, dan tidak punya nilai bawaan. Itu disengaja:
//
//   tersurvei        deret dari GPS/KMZ lapangan; ada yang benar-benar
//                    menyusurinya
//   perkiraan-jalan  hasil mesin rute; menempel di jalan, TAPI TIDAK ADA yang
//                    pernah menyusurinya
//
// Garis yang mengikuti jalan terlihat jauh lebih meyakinkan daripada garis
// lurus, dan karena itu lebih berbahaya kalau salah dipercaya. Nilai bawaan
// akan membuat orang memasang perkiraan lalu lupa menyebutnya perkiraan.
//
// PEMAKAIAN:
//   DATABASE_URL=… npx tsx scripts/pasang-jalur-kabel.ts \
//     --kabel BB-KECICANG-PESAGI-144 --berkas jalur.geojson --sumber tersurvei
//   … tambahkan --terapkan untuk benar-benar menulis
//   … --hapus untuk mencabut jalurnya kembali

import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const argv = process.argv.slice(2);
const nilai = (nama: string) => {
  const i = argv.indexOf(nama);
  return i >= 0 ? argv[i + 1] : undefined;
};
const TERAPKAN = argv.includes("--terapkan");
const HAPUS = argv.includes("--hapus");
const KODE = nilai("--kabel");
const BERKAS = nilai("--berkas");
const SUMBER = nilai("--sumber");

const SUMBER_SAH = ["tersurvei", "perkiraan-jalan"] as const;

function keluarSalah(pesan: string): never {
  console.error(`[jalur] ${pesan}`);
  process.exit(1);
}

async function main() {
  if (!KODE) keluarSalah("--kabel <kode> wajib diisi.");

  const { db } = await import("../src/db");
  const s = await import("../src/db/schema");
  const J = await import("../src/server/jalur-kabel");

  const [kabel] = await db
    .select({ id: s.fiberCableSegments.id, code: s.fiberCableSegments.code, lengthM: s.fiberCableSegments.lengthM })
    .from(s.fiberCableSegments)
    .where(eq(s.fiberCableSegments.code, KODE))
    .limit(1);
  if (!kabel) keluarSalah(`kabel ${KODE} tidak ada.`);

  if (HAPUS) {
    console.log(`[jalur] akan mencabut jalur dari ${kabel.code}.`);
    if (!TERAPKAN) return console.log("[jalur] tambahkan --terapkan.");
    await db
      .update(s.fiberCableSegments)
      .set({ route: null, routeSource: null, updatedAt: new Date() })
      .where(eq(s.fiberCableSegments.id, kabel.id));
    return console.log("[jalur] dicabut. Peta kembali ke garis lurus antar-jangkar.");
  }

  if (!BERKAS) keluarSalah("--berkas <path .geojson|.gpx> wajib diisi.");
  if (!SUMBER || !(SUMBER_SAH as readonly string[]).includes(SUMBER)) {
    keluarSalah(
      `--sumber wajib salah satu dari: ${SUMBER_SAH.join(", ")}. ` +
        "Tidak ada nilai bawaan — perkiraan yang tidak disebut perkiraan akan diikuti teknisi dengan percaya penuh.",
    );
  }

  let isi: string;
  try {
    isi = readFileSync(BERKAS, "utf8");
  } catch (e) {
    keluarSalah(`tidak bisa membaca ${BERKAS}: ${(e as Error).message}`);
  }

  let hasil;
  try {
    hasil = /\.gpx$/i.test(BERKAS) ? J.dariGpx(isi) : J.dariGeoJSON(JSON.parse(isi));
  } catch (e) {
    keluarSalah(`jalur ditolak: ${(e as Error).message}`);
  }

  const dup = J.duplikatBerurutan(hasil.titik);
  console.log(`[jalur] kabel  : ${kabel.code}`);
  console.log(`[jalur] berkas : ${BERKAS}`);
  console.log(`[jalur] titik  : ${hasil.titik.length}`);
  console.log(`[jalur] panjang: ${hasil.panjangM} m (dihitung dari deretnya)`);
  console.log(`[jalur] sumber : ${SUMBER}`);
  if (dup > 0) console.log(`[jalur] catatan: ${dup} titik berurutan identik — deretnya mungkin dirakit ceroboh.`);
  if (kabel.lengthM !== null && kabel.lengthM > 0) {
    const beda = Math.abs(hasil.panjangM - kabel.lengthM) / kabel.lengthM;
    if (beda > 0.2) {
      console.log(
        `[jalur] PERINGATAN: panjang jalur (${hasil.panjangM} m) meleset ${Math.round(beda * 100)}% ` +
          `dari length_m yang tercatat (${kabel.lengthM} m). Salah satunya keliru.`,
      );
    }
  }

  if (!TERAPKAN) return console.log("[jalur] tambahkan --terapkan untuk benar-benar menulis.");

  await db
    .update(s.fiberCableSegments)
    .set({
      route: hasil.titik,
      routeSource: SUMBER as (typeof SUMBER_SAH)[number],
      updatedAt: new Date(),
    })
    .where(eq(s.fiberCableSegments.id, kabel.id));
  // `length_m` sengaja TIDAK ditimpa. Panjang tercatat bisa berasal dari
  // pengukuran OTDR, dan itu lebih dipercaya daripada jumlah ruas di peta.
  console.log(`[jalur] terpasang pada ${kabel.code}.`);
}

main()
  .catch((e) => {
    console.error("[jalur] GAGAL:", e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
