// Mencuplik CPU, RAM, dan suhu per perangkat ke `device_metric_samples`.
//
// KENAPA ADA: portal ini menampilkan grafik riwayat sejak awal, tapi tidak
// pernah menyimpan riwayatnya. LibreNMS memuat nilai SEKARANG, bukan
// deretnya — jadi kalau tidak dicuplik, ia hilang. Sampai 22 Agustus 2026
// kekosongan itu ditutup dengan `generateHistorySeries()`, dan grafiknya
// berisi angka yang tidak pernah diukur.
//
// Bentuknya meniru `traffic.poll` yang sudah terbukti: satu pekerjaan
// berjadwal, satu tabel cuplikan, satu pemangkas. Tidak ada yang baru selain
// metriknya.

import { lt } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceMetricSamples } from "@/db/schema";
import type { TaskDefinition } from "@/server/scheduler";
import {
  fetchDeviceCpuUsage,
  fetchDeviceHealth,
  fetchDeviceMemUsage,
  isLibrenmsConfigured,
  sensorsToTemperature,
} from "@/server/librenms";

/**
 * Berapa lama cuplikan disimpan.
 *
 * Sama dengan trafik. Grafik riwayat perangkat dipakai untuk menjawab
 * "sejak kapan ini memburuk", dan pertanyaan itu hampir selalu tentang
 * beberapa hari terakhir — bukan beberapa bulan.
 */
export const RETENSI_HARI = 30;

export interface HasilCuplik {
  dicuplik: number;
  dilewati: number;
  pesan: string;
}

/**
 * Satu putaran pencuplikan.
 *
 * Perangkat yang KETIGA metriknya tidak terbaca tidak ditulis sama sekali —
 * baris yang seluruhnya null hanya menambah ukuran tabel tanpa menambah satu
 * pun fakta. Perangkat yang melaporkan sebagian tetap ditulis, dengan yang
 * tidak terbaca sebagai NULL — bukan 0.
 */
export async function cuplikMetrikPerangkat(now = new Date()): Promise<HasilCuplik> {
  if (!isLibrenmsConfigured()) {
    return { dicuplik: 0, dilewati: 0, pesan: "LibreNMS belum dikonfigurasi; tidak ada yang dicuplik." };
  }

  const daftar = await db
    .select({ assetId: assets.assetId, librenmsDeviceId: assets.librenmsDeviceId })
    .from(assets);

  const baris: Array<typeof deviceMetricSamples.$inferInsert> = [];
  let dilewati = 0;

  for (const a of daftar) {
    if (a.librenmsDeviceId === null) {
      // Perangkat yang dibaca lewat konsol CLI (mis. OLT tanpa SNMP) memang
      // tidak punya padanan di LibreNMS. Bukan kegagalan.
      dilewati += 1;
      continue;
    }
    const [cpu, ram, sensors] = await Promise.all([
      fetchDeviceCpuUsage(a.librenmsDeviceId),
      fetchDeviceMemUsage(a.librenmsDeviceId),
      fetchDeviceHealth(a.librenmsDeviceId),
    ]);
    // `sensorsToTemperature` sudah dipakai layar perangkat; memakai ulang
    // fungsi yang sama menjaga angka di grafik riwayat identik dengan angka
    // di kartu suhu, bukan sekadar mirip.
    const suhu = sensorsToTemperature(sensors)?.celsius ?? null;
    if (cpu === null && ram === null && suhu === null) {
      dilewati += 1;
      continue;
    }
    baris.push({
      assetId: a.assetId,
      sampledAt: now,
      cpuPercent: cpu,
      ramPercent: ram,
      tempCelsius: suhu,
    });
  }

  if (baris.length > 0) {
    // Putaran yang jatuh pada detik yang sama dengan putaran sebelumnya
    // (mis. sesudah restart worker) tidak boleh menggagalkan seluruhnya.
    await db.insert(deviceMetricSamples).values(baris).onConflictDoNothing();
  }
  return {
    dicuplik: baris.length,
    dilewati,
    pesan: `${baris.length} perangkat dicuplik, ${dilewati} dilewati`,
  };
}

export async function pangkasCuplikanMetrik(
  hari = RETENSI_HARI,
  now = new Date(),
): Promise<number> {
  const batas = new Date(now.getTime() - hari * 86_400_000);
  const hasil = await db
    .delete(deviceMetricSamples)
    .where(lt(deviceMetricSamples.sampledAt, batas))
    .returning({ assetId: deviceMetricSamples.assetId });
  return hasil.length;
}

export const DEVICE_METRIC_TASKS: TaskDefinition[] = [
  {
    code: "metrics.poll",
    name: "Cuplik CPU, RAM, dan suhu",
    description:
      "Menyimpan nilai CPU, RAM, dan suhu tiap perangkat supaya grafik riwayat punya sumber. Hanya membaca dari LibreNMS.",
    // Lima menit, bukan tiga puluh detik seperti trafik: ketiganya berubah
    // jauh lebih lambat, dan cuplikan sepadat itu hanya menambah baris tanpa
    // menambah yang bisa dibaca orang dari grafiknya.
    defaultIntervalSec: 300,
    enabledByDefault: true,
    run: async () => (await cuplikMetrikPerangkat()).pesan,
  },
  {
    code: "metrics.prune",
    name: "Pangkas cuplikan metrik lama",
    description: `Membuang cuplikan CPU/RAM/suhu yang lebih tua dari ${RETENSI_HARI} hari.`,
    defaultIntervalSec: 86_400,
    enabledByDefault: true,
    run: async () => `${await pangkasCuplikanMetrik()} baris dibuang`,
  },
];
