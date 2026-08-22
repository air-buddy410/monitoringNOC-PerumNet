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

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, trafficInterfaces, trafficSamples } from "@/db/schema";
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
 * Metrik yang BELUM punya sumber tersimpan, beserta alasannya.
 *
 * LibreNMS adalah sumber langsung untuk ketiganya, tapi portal ini tidak
 * menyimpan riwayatnya — tabel telemetry era SQLite dipensiunkan pada Fase 2
 * dan tidak pernah diganti. Menyebutnya di sini supaya layar bisa menjelaskan
 * kekosongannya, bukan menampilkan grafik datar yang tak bisa dijelaskan.
 */
const TANPA_SUMBER: Partial<Record<HistoryMetric, string>> = {
  cpu: "Riwayat CPU belum disimpan portal ini. LibreNMS memuat nilai sekarang, bukan deretnya.",
  ram: "Riwayat RAM belum disimpan portal ini. LibreNMS memuat nilai sekarang, bukan deretnya.",
  suhu: "Riwayat suhu belum disimpan portal ini. LibreNMS memuat nilai sekarang, bukan deretnya.",
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

export async function riwayatMetrik(opsi: {
  assetId: string;
  metric: HistoryMetric;
  hours: number;
  now?: Date;
}): Promise<HasilRiwayat> {
  const { assetId, metric, hours } = opsi;
  const now = opsi.now ?? new Date();

  if (metric !== "bandwidth") {
    // Di pengembangan tanpa LibreNMS, deret tiruan tetap dikirim supaya layar
    // grafik bisa dikerjakan — dan ia MENGAKU `fixture`. Aturan yang sama
    // dengan laporan SLA.
    if (!isLibrenmsConfigured()) return fixture(metric, hours, assetId);
    return kosong(metric, hours, TANPA_SUMBER[metric]!, now);
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
