// Riwayat metrik perangkat — dari pengukuran, bukan dari pembangkit angka.
//
// Sampai 22 Agustus 2026 endpoint `/api/devices/:id/metrics-history` mengisi
// grafiknya dengan `generateHistorySeries()`: angka deterministik per
// deviceId, bentuknya meyakinkan, dan tidak pernah diukur. Komentarnya sendiri
// berbunyi "nantinya query tabel metric_history" — dan tabel itu tidak pernah
// dibuat.
//
// Sementara itu `traffic_samples` sudah berisi 81 ribu cuplikan nyata dari
// worker sejak 20 Agustus. Jadi orang melihat angka karangan padahal
// pengukurannya ada, tersimpan, dan bertambah tiap dua menit.
//
// Ini kelas kesalahan yang sama dengan laporan SLA yang dulu menanam angka
// fixture ke produksi, dan penyelesaiannya pun sama: sebutkan sumbernya.
// Yang belum punya sumber mengaku belum punya sumber — tidak diganti angka
// yang terlihat masuk akal.

import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assets,
  deviceMetricSamples,
  trafficInterfaces,
  trafficSamples,
} from "@/db/schema";
import { isLibrenmsConfigured } from "@/server/librenms/client";
import { generateHistorySeries, type HistoryMetric } from "@/lib/mock-metrics";

export type SumberRiwayat = "terukur" | "fixture" | "belum-ada-data";

export interface TitikRiwayat {
  time: string;
  /**
   * `null` = tidak ada pengukuran pada rentang itu.
   *
   * BUKAN 0. Nol berarti "trafiknya berhenti"; null berarti "kami tidak
   * tahu". Layar yang menggambar keduanya sama akan melaporkan gangguan yang
   * tidak pernah terjadi — aturan yang sama sudah dipegang `bacaDeretTrafik`.
   */
  value: number | null;
}

export interface HasilRiwayat {
  metric: HistoryMetric;
  hours: number;
  sumber: SumberRiwayat;
  points: TitikRiwayat[];
  /** Kalimat penjelas; terisi hanya saat `belum-ada-data`. */
  catatan?: string;
  /** Berapa titik yang benar-benar punya pengukuran. */
  titikTerukur: number;
}

const JUMLAH_TITIK = 96;

/**
 * Kolom `device_metric_samples` untuk tiap metrik non-bandwidth.
 *
 * Sampai 22 Agustus 2026 ketiganya menjawab "belum ada sumber": LibreNMS
 * memuat nilai sekarang, dan portal ini tidak pernah menyimpan deretnya.
 * Sejak `metrics.poll` berjalan, sumbernya ada — dan peta ini yang
 * menghubungkan nama metrik di URL ke kolom yang menyimpannya.
 */
const KOLOM_METRIK = {
  cpu: deviceMetricSamples.cpuPercent,
  ram: deviceMetricSamples.ramPercent,
  suhu: deviceMetricSamples.tempCelsius,
} as const;

/**
 * Kalimat saat cuplikannya memang belum ada — perangkat baru, atau worker
 * belum sempat satu putaran pun pada rentang yang diminta.
 */
const BELUM_TERCUPLIK: Record<keyof typeof KOLOM_METRIK, string> = {
  cpu: "Belum ada cuplikan CPU pada rentang ini.",
  ram: "Belum ada cuplikan RAM pada rentang ini.",
  suhu: "Belum ada cuplikan suhu pada rentang ini. Sebagian perangkat memang tidak punya sensor suhu.",
};

function fixture(metric: HistoryMetric, hours: number, deviceId: string): HasilRiwayat {
  const points = generateHistorySeries(deviceId, metric, hours).map((p) => ({
    time: p.time,
    value: p.value as number | null,
  }));
  return { metric, hours, sumber: "fixture", points, titikTerukur: points.length };
}

function kosong(
  metric: HistoryMetric,
  hours: number,
  catatan: string,
  now: Date,
): HasilRiwayat {
  const lebar = (hours * 3_600_000) / JUMLAH_TITIK;
  const mulai = now.getTime() - hours * 3_600_000;
  // Titik tetap dikirim, isinya null. Deret kosong membuat grafik menghilang
  // seolah belum dimuat; deret berisi null menggambar sumbu waktu yang benar
  // dengan kekosongan yang terlihat.
  const points = Array.from({ length: JUMLAH_TITIK }, (_, i) => ({
    time: new Date(mulai + i * lebar).toISOString(),
    value: null,
  }));
  return { metric, hours, sumber: "belum-ada-data", points, catatan, titikTerukur: 0 };
}

/**
 * Bandwidth sebuah perangkat = jumlah rx+tx pada interface UPLINK-nya.
 *
 * Uplink, bukan seluruh interface: trafik yang masuk lewat satu port keluar
 * lewat port lain, jadi menjumlahkan semuanya menghitung lalu lintas yang
 * sama dua kali dan menghasilkan angka yang kira-kira dua kali lipat
 * kenyataan — persis jenis kesalahan yang tidak akan pernah terlihat salah.
 *
 * Perangkat dijodohkan lewat `assets.hostname` = `traffic_interfaces
 * .router_name`. Hostname-nya diambil LANGSUNG dari `assets`, bukan dari
 * proyeksi `NetworkDevice` — di sana `name` berisi `display_name` ("Router
 * Distribusi Nagabasukih"), yang tidak akan pernah cocok, dan gagalnya berupa
 * grafik kosong tanpa penjelasan.
 *
 * `management_ip` juga kebetulan sama nilainya, tapi ia kolom yang baru saja
 * salah selama dua hari — hostname lebih pantas dipercaya sebagai identitas.
 * Kalau keduanya kelak berbeda, penjodohan ini harus jadi kolom, bukan
 * tebakan.
 */
async function bandwidthTerukur(
  hostname: string,
  hours: number,
  now: Date,
): Promise<{ points: TitikRiwayat[]; terukur: number } | null> {
  const iface = await db
    .select({ id: trafficInterfaces.id })
    .from(trafficInterfaces)
    .where(
      and(
        eq(trafficInterfaces.routerName, hostname),
        eq(trafficInterfaces.role, "uplink"),
        eq(trafficInterfaces.isEnabled, true),
      ),
    );
  if (iface.length === 0) return null;

  const lebarDetik = Math.max(60, Math.round((hours * 3600) / JUMLAH_TITIK));
  const sejak = new Date(now.getTime() - hours * 3_600_000);
  const ids = iface.map((i) => i.id);

  const rows = await db
    .select({
      ember: sql<string>`date_bin(make_interval(secs => ${lebarDetik}), ${trafficSamples.sampledAt}, ${sejak})`,
      // Rata-rata per ember, dijumlahkan lintas interface uplink.
      total: sql<number>`sum(${trafficSamples.rxBps} + ${trafficSamples.txBps}) / count(distinct ${trafficSamples.sampledAt})`,
    })
    .from(trafficSamples)
    .where(
      and(
        sql`${trafficSamples.interfaceId} in ${ids}`,
        gte(trafficSamples.sampledAt, sejak),
        // Cuplikan acuan (dt_ms = 0) bukan pengukuran — menggambarnya sebagai
        // 0 bps memunculkan jurang palsu tiap kali worker restart.
        gte(trafficSamples.dtMs, 1),
      ),
    )
    .groupBy(sql`1`);

  const perEmber = new Map<number, number>();
  for (const r of rows) {
    const t = new Date(r.ember).getTime();
    if (!Number.isNaN(t)) perEmber.set(t, Number(r.total));
  }

  const lebarMs = lebarDetik * 1000;
  const points: TitikRiwayat[] = [];
  let terukur = 0;
  for (let i = 0; i < JUMLAH_TITIK; i += 1) {
    const t = sejak.getTime() + i * lebarMs;
    const bps = perEmber.get(t);
    if (bps === undefined) {
      points.push({ time: new Date(t).toISOString(), value: null });
    } else {
      // Mbps — satuan yang sudah dipakai layar grafik. Desimal dipertahankan
      // dua angka; membulatkan ke bilangan bulat menghapus perbedaan yang
      // berarti pada tautan di bawah 10 Mbps.
      points.push({ time: new Date(t).toISOString(), value: Math.round((bps / 1_000_000) * 100) / 100 });
      terukur += 1;
    }
  }
  return { points, terukur };
}

/**
 * Deret CPU/RAM/suhu dari `device_metric_samples`.
 *
 * Rata-rata per ember, bukan nilai terakhir: pada rentang 24 jam satu ember
 * memuat belasan cuplikan, dan memilih salah satunya membuat lonjakan
 * sesaat menentukan seluruh ember — atau hilang sama sekali, tergantung
 * cuplikan mana yang kebetulan terpilih.
 *
 * Ember tanpa baris bernilai `null`, bukan 0. Perangkat yang mati selama
 * enam jam harus menggambar enam jam kosong; garis 0% akan terbaca sebagai
 * "menganggur", yaitu kebalikan dari yang sebenarnya terjadi.
 */
async function cuplikanTerukur(
  assetId: string,
  metric: keyof typeof KOLOM_METRIK,
  hours: number,
  now: Date,
): Promise<{ points: TitikRiwayat[]; terukur: number }> {
  const kolom = KOLOM_METRIK[metric];
  const lebarDetik = Math.max(60, Math.round((hours * 3600) / JUMLAH_TITIK));
  const sejak = new Date(now.getTime() - hours * 3_600_000);

  const rows = await db
    .select({
      ember: sql<string>`date_bin(make_interval(secs => ${lebarDetik}), ${deviceMetricSamples.sampledAt}, ${sejak})`,
      nilai: sql<number>`avg(${kolom})`,
    })
    .from(deviceMetricSamples)
    .where(
      and(
        eq(deviceMetricSamples.assetId, assetId),
        // Mempersempit pindaian. Kebenarannya TIDAK bergantung pada baris
        // ini: cuplikan yang lebih tua dari `sejak` di-bin ke ember sebelum
        // `sejak`, dan gelung di bawah tidak pernah menanyakannya.
        gte(deviceMetricSamples.sampledAt, sejak),
        // Baris yang metrik INI-nya null tetap ada — perangkat itu melaporkan
        // metrik lain. Ini dan penjaga `r.nilai !== null` di bawah sengaja
        // rangkap: uji mutasi 22 Agustus 2026 menunjukkan MASING-MASING bisa
        // dibuang tanpa satu tes pun gagal, karena yang satu menutupi yang
        // lain — tapi membuang KEDUANYA membuat RAM yang tak terbaca digambar
        // 0%. Jangan menghapus salah satunya sambil menganggap tes menjaga.
        isNotNull(kolom),
      ),
    )
    .groupBy(sql`1`);

  const perEmber = new Map<number, number>();
  for (const r of rows) {
    const t = new Date(r.ember).getTime();
    // `Number(null)` adalah 0 — itulah sebabnya null disaring, bukan dipetakan.
    if (!Number.isNaN(t) && r.nilai !== null) perEmber.set(t, Number(r.nilai));
  }

  const lebarMs = lebarDetik * 1000;
  const points: TitikRiwayat[] = [];
  let terukur = 0;
  for (let i = 0; i < JUMLAH_TITIK; i += 1) {
    const t = sejak.getTime() + i * lebarMs;
    const nilai = perEmber.get(t);
    if (nilai === undefined) {
      points.push({ time: new Date(t).toISOString(), value: null });
    } else {
      points.push({
        time: new Date(t).toISOString(),
        value: Math.round(nilai * 10) / 10,
      });
      terukur += 1;
    }
  }
  return { points, terukur };
}

export async function riwayatMetrik(opsi: {
  assetId: string;
  metric: HistoryMetric;
  hours: number;
  now?: Date;
}): Promise<HasilRiwayat> {
  const { assetId, metric, hours } = opsi;
  const now = opsi.now ?? new Date();

  if (metric !== "bandwidth") {
    const cuplikan = await cuplikanTerukur(assetId, metric, hours, now);
    // Sama seperti bandwidth: "terukur" hanya sah kalau ada yang terukur.
    // Perangkat yang terdaftar tapi belum pernah tercuplik menghasilkan deret
    // yang seluruhnya null — menyebutnya terukur berarti mengaku mengukur
    // sesuatu yang tidak pernah diukur.
    if (cuplikan.terukur > 0) {
      return {
        metric,
        hours,
        sumber: "terukur",
        points: cuplikan.points,
        titikTerukur: cuplikan.terukur,
      };
    }
    // Di pengembangan tanpa LibreNMS, deret tiruan tetap dikirim supaya layar
    // grafik bisa dikerjakan — dan ia MENGAKU `fixture`. Aturan yang sama
    // dengan laporan SLA.
    if (!isLibrenmsConfigured()) return fixture(metric, hours, assetId);
    return kosong(metric, hours, BELUM_TERCUPLIK[metric], now);
  }

  const [aset] = await db
    .select({ hostname: assets.hostname })
    .from(assets)
    .where(eq(assets.assetId, assetId))
    .limit(1);
  const hostname = aset?.hostname ?? null;

  const terukur = hostname ? await bandwidthTerukur(hostname, hours, now) : null;
  // `terukur` hanya sah kalau ADA yang terukur. Interface uplink yang
  // terdaftar tapi belum satu pun cuplikannya lolos — misalnya baru dipasang,
  // atau seluruh cuplikannya berupa acuan `dt_ms = 0` — menghasilkan deret
  // yang seluruhnya null. Menyebutnya "terukur" berarti mengatakan angkanya
  // berasal dari pengukuran, padahal tidak ada satu pun pengukuran di sana.
  if (terukur && terukur.terukur > 0) {
    return {
      metric,
      hours,
      sumber: "terukur",
      points: terukur.points,
      titikTerukur: terukur.terukur,
    };
  }
  if (!isLibrenmsConfigured()) return fixture(metric, hours, assetId);
  if (terukur) {
    return kosong(
      metric,
      hours,
      `Interface uplink ${hostname} terdaftar, tapi belum ada cuplikan trafik pada rentang ini.`,
      now,
    );
  }
  return kosong(
    metric,
    hours,
    hostname
      ? `Belum ada interface uplink aktif untuk ${hostname}. Trafik dicatat per interface; perangkat tanpa uplink terdaftar belum punya deret bandwidth.`
      : "Perangkat ini tidak punya hostname di tabel aset, jadi interface trafiknya tidak bisa dijodohkan.",
    now,
  );
}
