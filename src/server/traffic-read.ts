// Pembacaan trafik untuk layar. Tidak pernah menyentuh router.
//
// Router HANYA dihubungi oleh worker. Kalau jalur permintaan HTTP ikut
// menghubunginya, satu router yang lambat menahan pemuatan halaman, dan
// sepuluh penonton layar TV jadi sepuluh panggilan ke perangkat produksi.
// Yang dibaca di sini murni tabel `traffic_samples`.

import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { trafficInterfaces, trafficSamples } from "@/db/schema";

export interface LajuInterface {
  id: string;
  ifName: string;
  label: string;
  role: "uplink" | "site" | "other";
  siteId: string | null;
  rxBps: number;
  txBps: number;
  capacityBps: number | null;
  /** null bila kapasitas tidak diketahui — BUKAN 0. */
  utilizationPercent: number | null;
  sampledAt: string | null;
  /** `belum-ada-data` dibedakan dari laju 0 yang jujur. */
  state: "ok" | "belum-ada-data" | "hilang";
  missingSince: string | null;
}

export interface TrafikLive {
  generatedAt: string;
  /** Cuplikan terbaru di antara seluruh interface. */
  sampledAt: string | null;
  ageSeconds: number | null;
  /** Data lebih tua dari 3 kali interval dianggap basi. */
  stale: boolean;
  totals: { uplinkRxBps: number; uplinkTxBps: number };
  interfaces: LajuInterface[];
}

const AMBANG_BASI_DETIK = 180;

export async function bacaTrafikLive(now = new Date()): Promise<TrafikLive> {
  const ifaces = await db
    .select()
    .from(trafficInterfaces)
    .where(eq(trafficInterfaces.isEnabled, true))
    .orderBy(trafficInterfaces.label);

  const ids = ifaces.map((i) => i.id);
  const terakhir = ids.length
    ? await db
        .selectDistinctOn([trafficSamples.interfaceId], {
          interfaceId: trafficSamples.interfaceId,
          sampledAt: trafficSamples.sampledAt,
          rxBps: trafficSamples.rxBps,
          txBps: trafficSamples.txBps,
          dtMs: trafficSamples.dtMs,
        })
        .from(trafficSamples)
        .where(inArray(trafficSamples.interfaceId, ids))
        .orderBy(trafficSamples.interfaceId, desc(trafficSamples.sampledAt))
    : [];
  const perId = new Map(terakhir.map((r) => [r.interfaceId, r]));

  let paling: Date | null = null;
  const interfaces: LajuInterface[] = ifaces.map((i) => {
    const s = perId.get(i.id);
    // dt_ms = 0 adalah cuplikan ACUAN, bukan pengukuran — lajunya bukan nol,
    // melainkan belum ada.
    const punyaLaju = s !== undefined && s.dtMs > 0;
    if (s && punyaLaju && (!paling || s.sampledAt > paling)) paling = s.sampledAt;
    const rxBps = punyaLaju ? s.rxBps : 0;
    const txBps = punyaLaju ? s.txBps : 0;
    return {
      id: i.id,
      ifName: i.ifName,
      label: i.label,
      role: i.role,
      siteId: i.siteId,
      rxBps,
      txBps,
      capacityBps: i.capacityBps,
      utilizationPercent: i.capacityBps
        ? Math.round((Math.max(rxBps, txBps) / i.capacityBps) * 1000) / 10
        : null,
      sampledAt: punyaLaju ? s.sampledAt.toISOString() : null,
      state: i.missingSince ? "hilang" : punyaLaju ? "ok" : "belum-ada-data",
      missingSince: i.missingSince ? i.missingSince.toISOString() : null,
    };
  });

  const uplink = interfaces.filter((i) => i.role === "uplink" && i.state === "ok");
  const umur = paling
    ? Math.round((now.getTime() - (paling as Date).getTime()) / 1000)
    : null;

  return {
    generatedAt: now.toISOString(),
    sampledAt: paling ? (paling as Date).toISOString() : null,
    ageSeconds: umur,
    stale: umur === null || umur > AMBANG_BASI_DETIK,
    totals: {
      uplinkRxBps: uplink.reduce((a, i) => a + i.rxBps, 0),
      uplinkTxBps: uplink.reduce((a, i) => a + i.txBps, 0),
    },
    interfaces,
  };
}

export interface TitikDeret {
  t: string;
  rxBps: number | null;
  txBps: number | null;
}

export interface DeretTrafik {
  interfaceId: string;
  label: string;
  hours: number;
  points: TitikDeret[];
  /** Bagian jendela waktu yang benar-benar punya data (0..1). */
  coverage: number;
}

export const MAKS_JAM = 24 * 30;

/**
 * Deret waktu satu interface.
 *
 * Titik yang tidak ada dikirim sebagai `null`, BUKAN 0 dan bukan dilewati.
 * Nol berarti "trafik berhenti"; tidak ada berarti "kami tidak tahu". Layar
 * yang menggambar keduanya sama akan melaporkan gangguan yang tidak pernah
 * terjadi.
 */
export async function bacaDeretTrafik(
  interfaceId: string,
  hours: number,
  now = new Date(),
): Promise<DeretTrafik | null> {
  const [iface] = await db
    .select()
    .from(trafficInterfaces)
    .where(eq(trafficInterfaces.id, interfaceId))
    .limit(1);
  if (!iface) return null;

  const jam = Math.min(Math.max(1, hours), MAKS_JAM);
  const sejak = new Date(now.getTime() - jam * 3_600_000);
  const rows = await db
    .select({
      sampledAt: trafficSamples.sampledAt,
      rxBps: trafficSamples.rxBps,
      txBps: trafficSamples.txBps,
    })
    .from(trafficSamples)
    .where(
      and(
        eq(trafficSamples.interfaceId, interfaceId),
        gte(trafficSamples.sampledAt, sejak),
        // Cuplikan acuan (dt_ms = 0) bukan pengukuran; menggambarnya sebagai
        // 0 bps akan memunculkan jurang palsu tiap kali worker restart.
        gte(trafficSamples.dtMs, 1),
      ),
    )
    .orderBy(trafficSamples.sampledAt);

  const points: TitikDeret[] = rows.map((r) => ({
    t: r.sampledAt.toISOString(),
    rxBps: r.rxBps,
    txBps: r.txBps,
  }));

  // Perkiraan cakupan: seberapa banyak titik yang ada dibanding yang
  // diharapkan pada jarak sampel yang terlihat.
  let coverage = 0;
  if (points.length >= 2) {
    const rentang =
      new Date(points.at(-1)!.t).getTime() - new Date(points[0].t).getTime();
    const jarakRata = rentang / (points.length - 1);
    const diharapkan = jarakRata > 0 ? (jam * 3_600_000) / jarakRata : 0;
    coverage = diharapkan > 0 ? Math.min(1, points.length / diharapkan) : 0;
  }

  return {
    interfaceId,
    label: iface.label,
    hours: jam,
    points,
    coverage: Math.round(coverage * 100) / 100,
  };
}
