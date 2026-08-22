// Jalur kabel: mengurai, memeriksa, dan mengukur deret titik.
//
// Kabel MENGIKUTI JALAN. Garis lurus antara dua ujung bukan jalurnya, dan
// pada bentangan antar-POP selisihnya bisa berkilo-kilometer — jarak lurus
// Kecicang–Seraya Tengah sekitar 9 km, sementara jalannya jauh lebih panjang.
//
// Modul ini sengaja tidak tahu-menahu dari mana titiknya berasal. Yang
// dijaganya cuma satu: yang masuk ke database adalah deret yang masuk akal,
// dan panjangnya dihitung dari deret itu — bukan ditebak.

export type Titik = [number, number];

export interface HasilJalur {
  titik: Titik[];
  /** Panjang jalur dalam meter, dihitung dari deretnya. */
  panjangM: number;
}

export class JalurTidakSah extends Error {}

/** Jari-jari bumi rata-rata (meter), untuk haversine. */
const JARI_JARI_BUMI_M = 6_371_008.8;

/**
 * Jarak dua titik di permukaan bumi, meter.
 *
 * Haversine, bukan Pythagoras pada derajat. Satu derajat bujur di Bali hanya
 * ~110 km × cos(8,4°) ≈ 109 km, sementara satu derajat lintang tetap ~111 km —
 * menghitungnya sebagai bidang datar meleset beberapa persen, dan panjang
 * kabel dipakai menakar jarak-ke-gangguan.
 */
export function jarakMeter(a: Titik, b: Titik): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * JARI_JARI_BUMI_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Panjang seluruh deret, meter. */
export function panjangJalur(titik: Titik[]): number {
  let total = 0;
  for (let i = 1; i < titik.length; i += 1) total += jarakMeter(titik[i - 1], titik[i]);
  return Math.round(total);
}

/**
 * Periksa deret titik.
 *
 * Yang ditolak, dan alasannya:
 *
 * - **Kurang dari dua titik.** Satu titik bukan jalur.
 * - **Bujur/lintang di luar jangkauan.** Hampir selalu berarti urutannya
 *   tertukar — `[lat, lon]` alih-alih `[lon, lat]`. Di Bali `lat` sekitar -8
 *   dan `lon` sekitar 115; kalau tertukar, lintangnya jadi 115 dan itu tidak
 *   ada di bumi. Ditolak keras, karena jalur yang tertukar akan digambar di
 *   Samudra Hindia tanpa satu pun galat.
 * - **Dua titik berurutan yang identik.** Bukan salah fatal, tapi menandakan
 *   deret yang dirakit ceroboh; dibuang diam-diam justru menyembunyikannya,
 *   jadi ia dilaporkan lewat `duplikatBerurutan`.
 */
export function periksaJalur(mentah: unknown): HasilJalur {
  if (!Array.isArray(mentah)) {
    throw new JalurTidakSah("Jalur harus berupa array titik [lon, lat].");
  }
  if (mentah.length < 2) {
    throw new JalurTidakSah(
      `Jalur butuh minimal 2 titik; yang diberikan ${mentah.length}.`,
    );
  }

  const titik: Titik[] = [];
  for (const [i, t] of mentah.entries()) {
    if (!Array.isArray(t) || t.length < 2) {
      throw new JalurTidakSah(`Titik ke-${i + 1} bukan pasangan [lon, lat].`);
    }
    const lon = Number(t[0]);
    const lat = Number(t[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new JalurTidakSah(`Titik ke-${i + 1} memuat nilai yang bukan angka.`);
    }
    if (lat < -90 || lat > 90) {
      throw new JalurTidakSah(
        `Titik ke-${i + 1}: lintang ${lat} di luar -90..90. ` +
          "Urutannya kemungkinan tertukar — yang benar [lon, lat], bukan [lat, lon].",
      );
    }
    if (lon < -180 || lon > 180) {
      throw new JalurTidakSah(`Titik ke-${i + 1}: bujur ${lon} di luar -180..180.`);
    }
    titik.push([lon, lat]);
  }

  return { titik, panjangM: panjangJalur(titik) };
}

/**
 * Ambil deret titik dari GeoJSON.
 *
 * Menerima `LineString`, `Feature` berisi LineString, atau
 * `FeatureCollection` berisi tepat SATU LineString. Lebih dari satu ditolak:
 * memilih salah satunya berarti memilih diam-diam, dan berkas hasil ekspor
 * survei yang memuat banyak jalur hampir pasti berisi lebih dari satu kabel.
 */
export function dariGeoJSON(mentah: unknown): HasilJalur {
  const obj = mentah as { type?: string; coordinates?: unknown; geometry?: unknown; features?: unknown[] };
  if (!obj || typeof obj !== "object") {
    throw new JalurTidakSah("Isi berkas bukan objek GeoJSON.");
  }
  if (obj.type === "LineString") return periksaJalur(obj.coordinates);
  if (obj.type === "Feature") return dariGeoJSON(obj.geometry);
  if (obj.type === "FeatureCollection") {
    const garis = (obj.features ?? []).filter(
      (f) => (f as { geometry?: { type?: string } })?.geometry?.type === "LineString",
    );
    if (garis.length === 0) throw new JalurTidakSah("FeatureCollection tidak memuat LineString.");
    if (garis.length > 1) {
      throw new JalurTidakSah(
        `FeatureCollection memuat ${garis.length} LineString. Pisahkan dulu — satu berkas untuk satu kabel.`,
      );
    }
    return dariGeoJSON(garis[0]);
  }
  throw new JalurTidakSah(`Jenis GeoJSON "${obj.type ?? "?"}" tidak didukung.`);
}

/**
 * Ambil deret titik dari GPX — keluaran lazim GPS lapangan.
 *
 * Diurai dengan regex, bukan pengurai XML penuh: yang dibutuhkan hanya
 * atribut `lat` dan `lon` pada `<trkpt>` atau `<rtept>`, dan menambah
 * dependensi pengurai XML demi itu tidak sepadan. Kalau kelak butuh lebih
 * (waktu, elevasi, banyak track), barulah pengurai sungguhan.
 */
export function dariGpx(xml: string): HasilJalur {
  const pola = /<(?:trkpt|rtept)\b[^>]*?\blat\s*=\s*"([^"]+)"[^>]*?\blon\s*=\s*"([^"]+)"[^>]*>/gi;
  const titik: Titik[] = [];
  for (const m of xml.matchAll(pola)) {
    // GPX menulis lat dulu; deret kita [lon, lat]. Tertukar di sini
    // menghasilkan jalur di Samudra Hindia — `periksaJalur` yang menangkapnya.
    titik.push([Number(m[2]), Number(m[1])]);
  }
  if (titik.length === 0) {
    throw new JalurTidakSah("GPX tidak memuat satu pun <trkpt> atau <rtept>.");
  }
  return periksaJalur(titik);
}

/** Dua titik berurutan yang identik — gejala deret yang dirakit ceroboh. */
export function duplikatBerurutan(titik: Titik[]): number {
  let n = 0;
  for (let i = 1; i < titik.length; i += 1) {
    if (titik[i][0] === titik[i - 1][0] && titik[i][1] === titik[i - 1][1]) n += 1;
  }
  return n;
}

/**
 * Sambungkan jalur hasil mesin rute ke koordinat jangkar yang sebenarnya.
 *
 * Mesin rute MENEMPELKAN titik awal dan akhir ke jalan terdekat. Untuk
 * Kecicang–Pesagi pergeserannya belasan meter; untuk perangkat yang berdiri
 * jauh dari jalan bisa jauh lebih besar. Kalau dibiarkan, garis di peta
 * berhenti di pinggir jalan dan tidak menyentuh penanda perangkatnya — dan
 * orang akan mengira ada yang salah dengan datanya.
 *
 * Yang dilakukan di sini bukan mengarang: ruas pendek dari perangkat ke jalan
 * memang ada di lapangan (drop dari rak ke tiang pertama). Ia ditambahkan
 * hanya kalau jaraknya berarti — menambah titik yang berimpit justru membuat
 * deretnya kotor.
 */
export function sambungKeJangkar(
  awal: Titik,
  rute: Titik[],
  akhir: Titik,
  ambangMeter = 5,
): Titik[] {
  const keluar = [...rute];
  if (keluar.length === 0) return [awal, akhir];
  if (jarakMeter(awal, keluar[0]) > ambangMeter) keluar.unshift(awal);
  if (jarakMeter(akhir, keluar[keluar.length - 1]) > ambangMeter) keluar.push(akhir);
  return keluar;
}

/**
 * Seberapa jauh mesin rute menggeser sebuah titik ke jalan terdekat.
 *
 * Dilaporkan, bukan disembunyikan: pergeseran besar berarti perangkatnya jauh
 * dari jalan mana pun, dan jalur yang dihitung untuknya patut lebih diragukan.
 */
export function pergeseranTempel(jangkar: Titik, rute: Titik[]): number {
  if (rute.length === 0) return 0;
  return Math.round(jarakMeter(jangkar, rute[0]));
}
