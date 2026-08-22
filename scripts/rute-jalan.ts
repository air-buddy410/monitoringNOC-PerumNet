// Menghitung jalur kabel yang MENGIKUTI JALAN, lewat mesin rute.
//
// Kabel tidak membentang lurus antar-titik; ia digantung menyusur jalan.
// Untuk Kecicang–Pesagi selisihnya nyata: 5.079 m menyusur jalan versus
// ~3.800 m garis lurus — 34% lebih panjang.
//
// ==========================================================================
// HASILNYA SELALU `perkiraan-jalan`. TIDAK PERNAH `tersurvei`.
// ==========================================================================
//
// Mesin rute tahu jalan yang ADA, bukan jalan tempat kabelnya DIGANTUNG. Ia
// bisa memilih jalan raya sementara kabelnya lewat gang, atau memutar lewat
// jalur yang tidak pernah dipasangi tiang. Hasilnya menempel di jalan — dan
// justru karena itu ia terlihat seperti hasil survei.
//
// Skrip ini karena itu TIDAK punya opsi untuk menandai hasilnya `tersurvei`.
// Bukan kelalaian; itu satu-satunya cara memastikan perkiraan tidak pernah
// menyamar jadi pengukuran. Jalur tersurvei dipasang lewat
// `pasang-jalur-kabel.ts` dari GPX/GeoJSON lapangan.
//
// KOORDINAT KELUAR DARI MESIN INI. Titik ujung tiap kabel dikirim ke layanan
// rute. Bawaannya OSRM publik, yang oleh pembuatnya sendiri disebut bukan
// untuk produksi. Setel `OSRM_URL` ke instans sendiri kalau koordinat POP
// tidak boleh keluar.
//
// PEMAKAIAN:
//   npx tsx scripts/rute-jalan.ts                       (kering, semua CONTOH-)
//   npx tsx scripts/rute-jalan.ts --terapkan
//   npx tsx scripts/rute-jalan.ts --kabel KODE --terapkan
//   OSRM_URL=http://127.0.0.1:5000 npx tsx scripts/rute-jalan.ts --terapkan

import { eq } from "drizzle-orm";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const argv = process.argv.slice(2);
const TERAPKAN = argv.includes("--terapkan");
const SATU = argv[argv.indexOf("--kabel") + 1];
const HANYA_SATU = argv.includes("--kabel") && SATU && !SATU.startsWith("--");

const OSRM = (process.env.OSRM_URL ?? "https://router.project-osrm.org").replace(/\/+$/, "");
const PROFIL = process.env.OSRM_PROFIL ?? "driving";

/**
 * Bawaannya HANYA menyentuh kabel contoh.
 *
 * Memasang perkiraan pada catatan lapangan sungguhan adalah keputusan yang
 * harus disengaja, bukan efek samping menjalankan skrip tanpa argumen.
 */
const AWALAN_AMAN = "CONTOH-";

type Titik = [number, number];

async function ruteJalan(a: Titik, b: Titik): Promise<{ titik: Titik[]; jarakM: number }> {
  const url =
    `${OSRM}/route/v1/${PROFIL}/${a[0]},${a[1]};${b[0]},${b[1]}` +
    "?overview=full&geometries=geojson";
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`mesin rute menjawab HTTP ${res.status}`);
  const body = (await res.json()) as {
    code?: string;
    routes?: Array<{ distance?: number; geometry?: { coordinates?: Titik[] } }>;
  };
  if (body.code !== "Ok" || !body.routes?.length) {
    throw new Error(`mesin rute menjawab code=${body.code ?? "?"}`);
  }
  const r = body.routes[0];
  const titik = r.geometry?.coordinates ?? [];
  if (titik.length < 2) throw new Error("mesin rute mengembalikan kurang dari 2 titik");
  return { titik, jarakM: Math.round(r.distance ?? 0) };
}

async function main() {
  const { db } = await import("../src/db");
  const s = await import("../src/db/schema");
  const { petaFiber } = await import("../src/server/fiber-geo");
  const J = await import("../src/server/jalur-kabel");

  console.log(`[rute] mesin  : ${OSRM} (profil ${PROFIL})`);
  console.log(`[rute] sumber : perkiraan-jalan — SELALU, tidak bisa diubah`);
  if (!TERAPKAN) console.log("[rute] KERING — tidak menulis apa pun");

  const peta = await petaFiber();
  const sasaran = peta.garis.filter((g) =>
    HANYA_SATU ? g.code === SATU : g.code.startsWith(AWALAN_AMAN),
  );

  if (sasaran.length === 0) {
    console.log(
      HANYA_SATU
        ? `[rute] ${SATU} tidak ada di daftar kabel yang bisa digambar (butuh dua jangkar berkoordinat).`
        : `[rute] tidak ada kabel berawalan ${AWALAN_AMAN} yang punya dua jangkar.`,
    );
    return;
  }

  console.log(`[rute] sasaran: ${sasaran.length} kabel\n`);

  for (const g of sasaran) {
    const awal = g.koordinat[0];
    const akhir = g.koordinat[g.koordinat.length - 1];
    if (awal[0] === akhir[0] && awal[1] === akhir[1]) {
      console.log(`  ${g.code}: dilewati — kedua ujungnya di titik yang sama.`);
      continue;
    }

    let hasil;
    try {
      hasil = await ruteJalan(awal, akhir);
    } catch (e) {
      console.log(`  ${g.code}: GAGAL — ${(e as Error).message}`);
      continue;
    }

    const geser = J.pergeseranTempel(awal, hasil.titik);
    const geserAkhir = J.pergeseranTempel(akhir, [...hasil.titik].reverse());
    const disambung = J.sambungKeJangkar(awal, hasil.titik, akhir);

    let periksa;
    try {
      periksa = J.periksaJalur(disambung);
    } catch (e) {
      console.log(`  ${g.code}: jalur ditolak — ${(e as Error).message}`);
      continue;
    }

    const lurus = J.panjangJalur([awal, akhir]);
    const lebih = lurus > 0 ? Math.round(((periksa.panjangM - lurus) / lurus) * 100) : 0;
    console.log(
      `  ${g.code.padEnd(26)} ${periksa.titik.length} titik · ` +
        `${periksa.panjangM} m (lurus ${lurus} m, +${lebih}%)`,
    );
    // Pergeseran besar berarti perangkatnya jauh dari jalan mana pun, dan
    // jalur yang dihitung untuknya patut lebih diragukan.
    if (geser > 100 || geserAkhir > 100) {
      console.log(
        `      catatan: ujungnya ditempel ke jalan sejauh ${geser} m / ${geserAkhir} m — ` +
          "perangkatnya jauh dari jalan, jalur ini lebih patut diragukan.",
      );
    }

    if (!TERAPKAN) continue;
    await db
      .update(s.fiberCableSegments)
      .set({
        route: periksa.titik,
        routeSource: "perkiraan-jalan",
        updatedAt: new Date(),
      })
      .where(eq(s.fiberCableSegments.id, g.id));
  }

  console.log(
    TERAPKAN
      ? "\n[rute] terpasang. Semuanya bertanda `perkiraan-jalan` — layar WAJIB membedakannya dari tersurvei."
      : "\n[rute] tambahkan --terapkan untuk benar-benar menulis.",
  );
}

main()
  .catch((e) => {
    console.error("[rute] GAGAL:", e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
