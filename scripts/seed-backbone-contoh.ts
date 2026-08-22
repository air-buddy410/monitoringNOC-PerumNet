// Backbone CONTOH antar seluruh situs — supaya lapisan peta dan trace punya
// tulang punggung yang bisa diklik.
//
// KENAPA ADA:
// Kabel backbone SUNGGUHAN `BB-KECICANG-PESAGI-144` sudah dimuat dari sheet
// lapangan, tapi ia punya 144 serat dan NOL terminasi — jadi peta menolak
// menggambarnya, dan itu benar. Skrip ini membangun rantai contoh di
// sebelahnya supaya layarnya bisa dilihat berisi tanpa satu pun garis karangan
// menempel pada catatan lapangan yang asli.
//
// KENAPA SETIAP KODE BERAWALAN `CONTOH-`:
// Kabel contoh yang tidak bisa dibedakan dari catatan lapangan akan dibaca
// sebagai backbone yang benar-benar terpasang, dan suatu hari ada teknisi
// dikirim menyusuri jalur yang tidak ada. Awalan itu satu-satunya pemisahnya,
// dan seluruh keamanan `--hapus` bergantung padanya.
//
// YANG HARUS DISADARI SAAT MELIHAT PETANYA:
// Garis yang digambar rantai ini adalah GARIS LURUS antar-titik OTB contoh di
// koordinat situs. Jalur backbone yang sebenarnya mengikuti jalan sepanjang
// kilometer. Karena itu kodenya berawalan CONTOH-, dan karena itu pula kabel
// yang asli sengaja TIDAK ikut diterminasi di sini.
//
// PEMAKAIAN:
//   DATABASE_URL=… npx tsx scripts/seed-backbone-contoh.ts            (kering)
//   DATABASE_URL=… npx tsx scripts/seed-backbone-contoh.ts --terapkan
//   DATABASE_URL=… npx tsx scripts/seed-backbone-contoh.ts --hapus --terapkan

import { and, eq, inArray, like } from "drizzle-orm";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const TERAPKAN = process.argv.includes("--terapkan");
const HAPUS = process.argv.includes("--hapus");

const AWALAN = "CONTOH-BB-";
const AWALAN_OTB = "CONTOH-OTB-BB-";
const CATATAN = "Data CONTOH — backbone antar situs, dibuat seed-backbone-contoh.ts.";

/**
 * Rantai yang menghubungkan seluruh situs.
 *
 * Bentuknya pohon rentang mengikuti bujur: Kecicang di barat, Seraya Tengah
 * di timur, dengan Abang sebagai cabang ke utara. Ini TEBAKAN yang masuk akal
 * secara geografi, bukan jalur yang tersurvei — sekali lagi alasan awalan
 * `CONTOH-`.
 */
const RANTAI: Array<[string, string]> = [
  ["KCC", "NGB"],
  ["KCC", "ABG"],
  ["KCC", "PSG"],
  ["PSG", "SRYB"],
  ["SRYB", "SRYT"],
];

const CORE_COUNT = 144;
const TUBE_SIZE = 12;

async function main() {
  const { db } = await import("../src/db");
  const s = await import("../src/db/schema");
  const otbStore = await import("../src/server/otb-store");
  const fiber = await import("../src/server/fiber-store");

  const dimana = process.env.DATABASE_URL ? "PostgreSQL (DATABASE_URL)" : "PGlite lokal";
  console.log(`[backbone] database: ${dimana}${TERAPKAN ? "" : " — KERING, tidak menulis apa pun"}`);

  const situs = await db.select().from(s.networkSites);
  const perKode = new Map(situs.map((x) => [x.code, x]));

  if (HAPUS) {
    const kabel = await db
      .select({ id: s.fiberCableSegments.id })
      .from(s.fiberCableSegments)
      .where(like(s.fiberCableSegments.code, `${AWALAN}%`));
    const otbs = await db
      .select({ id: s.otb.id })
      .from(s.otb)
      .where(like(s.otb.code, `${AWALAN_OTB}%`));
    console.log(`[backbone] akan menghapus: ${kabel.length} kabel, ${otbs.length} OTB`);
    if (!TERAPKAN) return console.log("[backbone] tambahkan --terapkan untuk benar-benar menghapus.");
    // Terminasi ikut terbawa `onDelete: cascade` dari kedua sisinya.
    if (kabel.length) await db.delete(s.fiberCableSegments).where(inArray(s.fiberCableSegments.id, kabel.map((k) => k.id)));
    if (otbs.length) await db.delete(s.otb).where(inArray(s.otb.id, otbs.map((o) => o.id)));
    return console.log("[backbone] terhapus.");
  }

  const hilang = [...new Set(RANTAI.flat())].filter((k) => !perKode.has(k));
  if (hilang.length) {
    console.error(`[backbone] situs tidak ada: ${hilang.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const sudahAda = await db
    .select({ code: s.fiberCableSegments.code })
    .from(s.fiberCableSegments)
    .where(like(s.fiberCableSegments.code, `${AWALAN}%`));
  if (sudahAda.length > 0) {
    console.error(`[backbone] ${sudahAda.length} kabel contoh sudah ada. Jalankan --hapus --terapkan dulu.`);
    process.exitCode = 1;
    return;
  }

  const kodeSitus = [...new Set(RANTAI.flat())];
  console.log(
    `[backbone] akan membuat: ${kodeSitus.length} OTB (1 per situs) · ` +
      `${RANTAI.length} kabel ${CORE_COUNT} core · ${RANTAI.length * 2} terminasi`,
  );
  for (const [a, b] of RANTAI) console.log(`    ${a} ←→ ${b}`);
  if (!TERAPKAN) return console.log("[backbone] tambahkan --terapkan untuk benar-benar menulis.");

  // Satu OTB per situs, di koordinat situsnya.
  const otbPerSitus = new Map<string, string>();
  for (const kode of kodeSitus) {
    const st = perKode.get(kode)!;
    const h = await otbStore.buatOtb(
      {
        code: `${AWALAN_OTB}${kode}`,
        name: `OTB Backbone ${st.name}`,
        siteId: st.id,
        trayCount: 2,
        portsPerTray: 24,
        latitude: st.latitude,
        longitude: st.longitude,
        notes: CATATAN,
      },
      null,
    );
    if (!h.ok) throw new Error(`OTB ${kode}: ${h.error}`);
    otbPerSitus.set(kode, h.data.id);
  }
  console.log(`[backbone] ${otbPerSitus.size} OTB dibuat.`);

  // Nomor port dihitung PER OTB, bukan sekali untuk semua: Kecicang
  // menampung tiga kabel sekaligus, dan ketiganya tidak boleh berebut port 1.
  const portTerpakai = new Map<string, number>();
  for (const [a, b] of RANTAI) {
    const kode = `${AWALAN}${a}-${b}-${CORE_COUNT}`;
    const h = await fiber.buatKabel(
      {
        code: kode,
        name: `Backbone contoh ${perKode.get(a)!.name}–${perKode.get(b)!.name}`,
        category: "backbone",
        coreCount: CORE_COUNT,
        tubeSize: TUBE_SIZE,
        purpose: "feeder",
        siteAId: perKode.get(a)!.id,
        siteBId: perKode.get(b)!.id,
        notes: CATATAN,
      },
      null,
    );
    if (!h.ok) throw new Error(`kabel ${kode}: ${h.error}`);

    // Satu core diterminasi di tiap ujung — cukup untuk memberi peta dua
    // jangkar. Sisanya dibiarkan kosong, seperti backbone sungguhan yang
    // seratnya jauh lebih banyak daripada yang terpakai.
    const [core1] = await db
      .select({ id: s.fiberCores.id })
      .from(s.fiberCores)
      .where(and(eq(s.fiberCores.segmentId, h.data.id), eq(s.fiberCores.coreNumber, 1)))
      .limit(1);

    for (const [ujung, kodeSitusUjung] of [["A", a], ["B", b]] as const) {
      const otbId = otbPerSitus.get(kodeSitusUjung)!;
      const berikut = (portTerpakai.get(otbId) ?? 0) + 1;
      portTerpakai.set(otbId, berikut);
      // Dipilih lewat nomor portnya, bukan lewat `limit` — `limit(n)` tetap
      // mengambil baris PERTAMA, jadi seluruh kabel akan berebut port yang
      // sama dan terminasi kedua ditolak aturan okupansi.
      const [port] = await db
        .select({ id: s.otbPorts.id })
        .from(s.otbPorts)
        .where(
          and(
            eq(s.otbPorts.otbId, otbId),
            eq(s.otbPorts.globalPortNumber, berikut),
          ),
        )
        .limit(1);
      if (!port) throw new Error(`port ${berikut} tidak ada di OTB ${kodeSitusUjung}`);
      const r = await fiber.terminasiCore(
        { coreId: core1.id, coreEnd: ujung, otbPortId: port.id, reason: CATATAN },
        null,
      );
      if (!r.ok) throw new Error(`terminasi ${kode} ujung ${ujung}: ${r.error}`);
    }
    console.log(`[backbone] ${kode} · ${a} ←→ ${b} · core 1 diterminasi di kedua ujung`);
  }

  console.log("[backbone] selesai. Buka layar peta — rantainya sekarang tergambar.");
}

main()
  .catch((e) => {
    console.error("[backbone] GAGAL:", e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
