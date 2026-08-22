// Jalur kabel — deret titik yang mengikuti jalan, bukan garis lurus.
//
// Yang dijaga:
//   1. Lat/lon tertukar DITOLAK. Di Bali lintang ~-8 dan bujur ~115; kalau
//      tertukar, jalurnya digambar di Samudra Hindia tanpa satu pun galat.
//   2. Panjang dihitung haversine, bukan Pythagoras pada derajat.
//   3. Peta memakai jalur tersimpan, dan MENGAKU sumbernya.
//   4. Jalur tersimpan yang cacat tidak dipakai diam-diam.

import { describe, expect, it } from "vitest";
import {
  JalurTidakSah,
  pergeseranTempel,
  sambungKeJangkar,
  dariGeoJSON,
  dariGpx,
  duplikatBerurutan,
  jarakMeter,
  periksaJalur,
} from "@/server/jalur-kabel";

const KCC: [number, number] = [115.5896239747118, -8.449851221181337];
const PSG: [number, number] = [115.6228694410912, -8.460566903716224];

describe("periksaJalur", () => {
  it("menerima deret yang sah dan menghitung panjangnya", () => {
    const h = periksaJalur([KCC, PSG]);
    expect(h.titik).toHaveLength(2);
    // Jarak lurus Kecicang–Pesagi sekitar 3,8 km.
    expect(h.panjangM).toBeGreaterThan(3_500);
    expect(h.panjangM).toBeLessThan(4_200);
  });

  it("MENOLAK lat/lon yang tertukar", () => {
    // [lat, lon] alih-alih [lon, lat] → lintang 115, yang tidak ada di bumi.
    // Tanpa penolakan ini jalurnya digambar di Samudra Hindia, dan tidak ada
    // yang melempar galat.
    expect(() => periksaJalur([[-8.4498, 115.5896], [-8.4605, 115.6228]]))
      .toThrow(JalurTidakSah);
    try {
      periksaJalur([[-8.4498, 115.5896], [-8.4605, 115.6228]]);
    } catch (e) {
      expect((e as Error).message).toMatch(/tertukar/);
    }
  });

  it("menolak deret berisi kurang dari dua titik", () => {
    expect(() => periksaJalur([KCC])).toThrow(JalurTidakSah);
    expect(() => periksaJalur([])).toThrow(JalurTidakSah);
  });

  it("menolak titik yang bukan angka", () => {
    expect(() => periksaJalur([KCC, ["x", "y"]])).toThrow(JalurTidakSah);
  });

  it("menolak yang bukan array sama sekali", () => {
    expect(() => periksaJalur("bukan jalur")).toThrow(JalurTidakSah);
    expect(() => periksaJalur(null)).toThrow(JalurTidakSah);
  });
});

describe("jarakMeter", () => {
  it("memakai haversine, bukan Pythagoras pada derajat", () => {
    // Satu derajat LINTANG ≈ 111 km di mana pun. Satu derajat BUJUR di Bali
    // (lintang -8,4) hanya ≈ 110 km × cos(8,4°) ≈ 110 km. Pythagoras pada
    // derajat menganggap keduanya sama panjang dan meleset.
    const seDerajatLintang = jarakMeter([115, -8], [115, -9]);
    const seDerajatBujur = jarakMeter([115, -8], [116, -8]);
    expect(seDerajatLintang).toBeGreaterThan(110_000);
    expect(seDerajatLintang).toBeLessThan(112_000);
    // Bujur harus LEBIH PENDEK daripada lintang di lintang -8.
    expect(seDerajatBujur).toBeLessThan(seDerajatLintang);
    expect(seDerajatBujur).toBeGreaterThan(109_000);
  });

  it("titik yang sama berjarak nol", () => {
    expect(jarakMeter(KCC, KCC)).toBe(0);
  });

  it("jalur berkelok LEBIH PANJANG daripada garis lurus", () => {
    // Inti seluruh fitur ini: kabel mengikuti jalan, dan jalan lebih panjang.
    const lurus = periksaJalur([KCC, PSG]).panjangM;
    const berkelok = periksaJalur([KCC, [115.60, -8.44], [115.61, -8.47], PSG]).panjangM;
    expect(berkelok).toBeGreaterThan(lurus);
  });
});

describe("dariGeoJSON", () => {
  it("membaca LineString", () => {
    expect(dariGeoJSON({ type: "LineString", coordinates: [KCC, PSG] }).titik).toHaveLength(2);
  });

  it("membaca Feature dan FeatureCollection bertepat satu LineString", () => {
    const f = { type: "Feature", geometry: { type: "LineString", coordinates: [KCC, PSG] } };
    expect(dariGeoJSON(f).titik).toHaveLength(2);
    expect(dariGeoJSON({ type: "FeatureCollection", features: [f] }).titik).toHaveLength(2);
  });

  it("MENOLAK FeatureCollection berisi lebih dari satu LineString", () => {
    // Memilih salah satunya berarti memilih diam-diam — dan berkas ekspor
    // survei yang memuat banyak jalur hampir pasti berisi lebih dari satu
    // kabel.
    const f = { type: "Feature", geometry: { type: "LineString", coordinates: [KCC, PSG] } };
    expect(() => dariGeoJSON({ type: "FeatureCollection", features: [f, f] }))
      .toThrow(/2 LineString/);
  });

  it("menolak jenis GeoJSON yang tidak didukung", () => {
    expect(() => dariGeoJSON({ type: "Point", coordinates: KCC })).toThrow(JalurTidakSah);
  });
});

describe("dariGpx", () => {
  it("membaca trkpt dan MEMBALIK urutannya jadi [lon, lat]", () => {
    // GPX menulis lat dulu. Tertukar di sini menghasilkan jalur di Samudra
    // Hindia — dan `periksaJalur` yang akan menangkapnya.
    const gpx = `<gpx><trk><trkseg>
      <trkpt lat="-8.449851" lon="115.589624"/>
      <trkpt lat="-8.460567" lon="115.622869"/>
    </trkseg></trk></gpx>`;
    const h = dariGpx(gpx);
    expect(h.titik[0][0]).toBeCloseTo(115.5896, 3);
    expect(h.titik[0][1]).toBeCloseTo(-8.4499, 3);
  });

  it("membaca rtept juga", () => {
    const gpx = `<gpx><rte>
      <rtept lat="-8.449851" lon="115.589624"/>
      <rtept lat="-8.460567" lon="115.622869"/>
    </rte></gpx>`;
    expect(dariGpx(gpx).titik).toHaveLength(2);
  });

  it("GPX tanpa titik ditolak, bukan menghasilkan jalur kosong", () => {
    expect(() => dariGpx("<gpx></gpx>")).toThrow(JalurTidakSah);
  });
});

describe("duplikatBerurutan", () => {
  it("menghitung titik berurutan yang identik", () => {
    expect(duplikatBerurutan([KCC, KCC, PSG])).toBe(1);
    expect(duplikatBerurutan([KCC, PSG])).toBe(0);
  });
});

describe("sambungKeJangkar", () => {
  // Mesin rute MENEMPELKAN ujung ke jalan terdekat. Kalau dibiarkan, garis di
  // peta berhenti di pinggir jalan dan tidak menyentuh penanda perangkatnya.
  const jalanDekatKcc: [number, number] = [115.589759, -8.449934];
  const jalanDekatPsg: [number, number] = [115.62291, -8.460334];

  it("menyambungkan ujung yang tergeser ke koordinat perangkat", () => {
    const hasil = sambungKeJangkar(KCC, [jalanDekatKcc, jalanDekatPsg], PSG);
    expect(hasil).toHaveLength(4);
    expect(hasil[0]).toEqual(KCC);
    expect(hasil[hasil.length - 1]).toEqual(PSG);
  });

  it("TIDAK menambah titik yang praktis berimpit", () => {
    // Menambah titik berjarak sentimeter cuma mengotori deret tanpa mengubah
    // apa pun yang terlihat.
    const hasil = sambungKeJangkar(KCC, [KCC, PSG], PSG);
    expect(hasil).toHaveLength(2);
  });

  it("rute kosong jatuh ke dua jangkar, bukan deret kosong", () => {
    expect(sambungKeJangkar(KCC, [], PSG)).toEqual([KCC, PSG]);
  });

  it("hasilnya lolos periksaJalur", () => {
    const hasil = sambungKeJangkar(KCC, [jalanDekatKcc, jalanDekatPsg], PSG);
    expect(() => periksaJalur(hasil)).not.toThrow();
  });
});

describe("pergeseranTempel", () => {
  it("mengukur seberapa jauh ujung digeser ke jalan", () => {
    const geser = pergeseranTempel(KCC, [[115.589759, -8.449934], PSG]);
    // Pergeseran Kecicang pada rute nyata belasan meter.
    expect(geser).toBeGreaterThan(0);
    expect(geser).toBeLessThan(100);
  });

  it("rute kosong berarti nol, bukan NaN", () => {
    expect(pergeseranTempel(KCC, [])).toBe(0);
  });
});
