// Satu muatan untuk seluruh layar TV.
//
// Satu permintaan, bukan enam. Alasannya bukan penghematan:
//
//   1. Enam permintaan berarti enam UMUR DATA berbeda di satu layar — grafik
//      segar di sebelah peta basi, tanpa cara tahu mana yang mana.
//   2. Satu `generatedAt` berarti satu indikator kesegaran yang jujur.
//   3. Satu titik otorisasi. Enam endpoint yang menerima cookie TV adalah
//      enam tempat untuk lupa.
//
// **Yang sengaja TIDAK ada di sini: alamat IP, hostname, vendor, model,
// nomor seri — dan USERNAME PELANGGAN.** Token TV bisa bocor — pemiliknya
// sudah menerima risiko itu. Yang bocor tidak boleh berupa inventaris
// jaringan, dan tidak boleh berupa daftar pelanggan.
//
// Username itu sempat lolos: `outages` dulu memakai `ReturnType<typeof
// ringkasPadam>` apa adanya, dan `Gerombol.usernames` ikut terbawa ke layar
// yang dipasang di ruangan terbuka. Karena itu bentuk `outages` di sini
// DITULIS SENDIRI, bukan diwarisi — supaya kolom baru di hulu tidak pernah
// lagi sampai ke TV hanya karena tidak ada yang menghalanginya.

import { desc, gte } from "drizzle-orm";
import { db } from "@/db";
import { pppoePollRuns } from "@/db/schema";
import { getAssetsWithStatus } from "@/server/device-store";
import { listIncidents } from "@/server/incident-store";
import { ringkasPadam } from "@/server/outage";
import { rapikanPadam, type RingkasanPadamTv } from "@/server/tv-sanitize";
import { bacaTrafikLive, type TrafikLive } from "@/server/traffic-read";

export interface PenandaTv {
  id: string;
  label: string;
  lat: number;
  lng: number;
  status: string;
}

export interface TvSnapshot {
  generatedAt: string;
  traffic: TrafikLive;
  devices: {
    total: number;
    online: number;
    warning: number;
    offline: number;
    markers: PenandaTv[];
  };
  outages: RingkasanPadamTv;
  incidents: {
    id: string;
    deviceName: string;
    message: string;
    severity: string;
    state: string;
    triggeredAt: string;
  }[];
  pppoe: {
    current: number | null;
    lastRunStatus: string | null;
    trend: { t: string; count: number }[];
  };
}

async function trenPppoe(now: Date) {
  const sejak = new Date(now.getTime() - 24 * 3_600_000);
  const rows = await db
    .select({
      startedAt: pppoePollRuns.startedAt,
      status: pppoePollRuns.status,
      sessionCount: pppoePollRuns.sessionCount,
    })
    .from(pppoePollRuns)
    .where(gte(pppoePollRuns.startedAt, sejak))
    .orderBy(desc(pppoePollRuns.startedAt))
    .limit(2000);

  const sukses = rows.filter((r) => r.status === "SUCCESS" && r.sessionCount !== null);
  // Diambil ±96 titik supaya kurva 24 jam tidak mengirim ribuan titik ke TV.
  const langkah = Math.max(1, Math.floor(sukses.length / 96));
  const trend = sukses
    .filter((_, i) => i % langkah === 0)
    .reverse()
    .map((r) => ({ t: r.startedAt.toISOString(), count: r.sessionCount ?? 0 }));

  return {
    current: sukses[0]?.sessionCount ?? null,
    lastRunStatus: rows[0]?.status ?? null,
    trend,
  };
}

export async function bacaTvSnapshot(now = new Date()): Promise<TvSnapshot> {
  const [traffic, aset, insiden, padam, pppoe] = await Promise.all([
    bacaTrafikLive(now),
    getAssetsWithStatus(),
    listIncidents({ limit: 10 }),
    ringkasPadam(),
    trenPppoe(now),
  ]);

  const hitung = { online: 0, warning: 0, offline: 0 } as Record<string, number>;
  const markers: PenandaTv[] = [];
  for (const a of aset.assets) {
    hitung[a.status] = (hitung[a.status] ?? 0) + 1;
    if (a.latitude === null || a.longitude === null) continue;
    // Sengaja dipangkas: nama tampilan, koordinat, status. Tidak ada IP,
    // hostname, vendor, model, atau nomor seri.
    markers.push({
      id: a.assetId,
      label: a.displayName ?? a.hostname,
      lat: a.latitude,
      lng: a.longitude,
      status: a.status,
    });
  }

  return {
    generatedAt: now.toISOString(),
    traffic,
    devices: {
      total: aset.assets.length,
      online: hitung.online ?? 0,
      warning: hitung.warning ?? 0,
      offline: hitung.offline ?? 0,
      markers,
    },
    outages: rapikanPadam(padam),
    // `deviceName` dan `message` memang tampil di layar — itu memang guna
    // insidennya. Yang tidak ikut tetap tidak ikut: alamat IP, hostname,
    // vendor, model.
    incidents: insiden.incidents
      .filter((i) => i.state !== "resolved")
      .slice(0, 10)
      .map((i) => ({
        id: i.id,
        deviceName: i.deviceName,
        message: i.message,
        severity: i.severity,
        state: i.state,
        triggeredAt: i.triggeredAt,
      })),
    pppoe,
  };
}
