// Layanan data laporan (SLA & trafik) di sisi server.
//
// Rekap bulanan disimpan di tabel cache sla_monthly / traffic_monthly.
// DEVELOPMENT: saat sebuah periode belum punya rekap, tabel di-seed dari
// generator fixture (deterministik per periode+aset) — hanya bila mode
// FIXTURE (LIBRENMS_URL/TOKEN tidak di-set). Produksi/terhubung: seed
// tidak dijalankan; data harus diisi dari agregasi LibreNMS.

import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, slaMonthly, trafficMonthly } from "@/db/schema";
import { FIXTURE_ASSETS } from "@/lib/fixtures/assets";
import {
  generateSlaReport,
  generateTrafficReport,
  SLA_TARGET_PERCENT,
} from "@/lib/mock-reports";
import { isLibrenmsConfigured } from "@/server/librenms";
import type { Asset } from "@/types/asset";

export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Grup tampilan legacy untuk UI laporan (role olt → OLT, selain itu vendor). */
function legacyGroup(networkRole: string, vendor: string): string {
  return networkRole === "olt" ? "OLT" : vendor;
}

/** DEVELOPMENT SEED — mengisi tabel assets dari fixture bila BELUM ADA dan
 * mode FIXTURE (tidak terhubung ke LibreNMS). Produksi/terhubung: TIDAK
 * menyentuh tabel assets. */
export async function ensureAssetsSeed() {
  // Jangan pernah menulis fixture ke DB produksi/terhubung.
  if (isLibrenmsConfigured()) return;
  for (const asset of FIXTURE_ASSETS) {
    await db
      .insert(assets)
      .values(assetToRow(asset))
      .onConflictDoNothing();
  }
}

function assetToRow(asset: Asset) {
  return {
    assetId: asset.assetId,
    librenmsDeviceId: asset.librenmsDeviceId,
    hostname: asset.hostname,
    displayName: asset.displayName,
    managementIp: asset.managementIp,
    vendor: asset.vendor,
    os: asset.os,
    model: asset.model,
    serialNumber: asset.serialNumber,
    site: asset.site,
    location: asset.location,
    latitude: asset.latitude,
    longitude: asset.longitude,
    tags: asset.tags,
    networkRole: asset.networkRole,
  };
}

async function seedSlaIfMissing(period: string) {
  const [existing] = await db
    .select({ id: slaMonthly.id })
    .from(slaMonthly)
    .where(eq(slaMonthly.period, period))
    .limit(1);
  if (existing) return;

  await ensureAssetsSeed();
  for (const row of generateSlaReport(period)) {
    await db
      .insert(slaMonthly)
      .values({
        id: randomUUID(),
        assetId: row.deviceId,
        period,
        uptimePercent: row.uptimePercent,
        downtimeMinutes: row.downtimeMinutes,
        incidents: row.incidents,
      })
      .onConflictDoNothing();
  }
}

export async function getSlaReport(period: string) {
  await seedSlaIfMissing(period);

  const rows = await db
    .select({
      deviceId: slaMonthly.assetId,
      deviceName: assets.displayName,
      vendor: assets.vendor,
      networkRole: assets.networkRole,
      area: assets.site,
      uptimePercent: slaMonthly.uptimePercent,
      downtimeMinutes: slaMonthly.downtimeMinutes,
      incidents: slaMonthly.incidents,
    })
    .from(slaMonthly)
    .innerJoin(assets, eq(slaMonthly.assetId, assets.assetId))
    .where(eq(slaMonthly.period, period))
    .orderBy(asc(slaMonthly.uptimePercent));

  const withTarget = rows.map(({ vendor, networkRole, ...row }) => ({
    ...row,
    group: legacyGroup(networkRole, vendor),
    meetsTarget: row.uptimePercent >= SLA_TARGET_PERCENT,
  }));
  const averageUptime =
    rows.length === 0
      ? 0
      : Math.round(
          (rows.reduce((sum, row) => sum + row.uptimePercent, 0) /
            rows.length) *
            100,
        ) / 100;

  return {
    period,
    targetPercent: SLA_TARGET_PERCENT,
    rows: withTarget,
    summary: {
      devices: rows.length,
      averageUptime,
      belowTarget: withTarget.filter((row) => !row.meetsTarget).length,
    },
  };
}

async function seedTrafficIfMissing(period: string) {
  const [existing] = await db
    .select({ id: trafficMonthly.id })
    .from(trafficMonthly)
    .where(eq(trafficMonthly.period, period))
    .limit(1);
  if (existing) return;

  await ensureAssetsSeed();
  for (const row of generateTrafficReport(period)) {
    await db
      .insert(trafficMonthly)
      .values({
        id: randomUUID(),
        assetId: row.deviceId,
        period,
        downloadGb: row.downloadGB,
        uploadGb: row.uploadGB,
        avgMbps: row.avgMbps,
        peakMbps: row.peakMbps,
      })
      .onConflictDoNothing();
  }
}

/** Daftar periode "YYYY-MM" inklusif dari `from` sampai `to`. */
export function enumerateMonths(from: string, to: string): string[] {
  const months: string[] = [];
  let [year, month] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  while (year < toYear || (year === toYear && month <= toMonth)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/**
 * Rekap trafik ter-agregasi untuk rentang bulan [from..to]: total volume
 * dijumlahkan, rata-rata Mbps dirata-ratakan, puncak diambil maksimum.
 */
export async function getTrafficReportRange(from: string, to: string) {
  const months = enumerateMonths(from, to);
  const perDevice = new Map<
    string,
    {
      deviceId: string;
      deviceName: string;
      group: string;
      area: string;
      downloadGb: number;
      uploadGb: number;
      avgMbpsSum: number;
      peakMbps: number;
      monthsCounted: number;
    }
  >();

  for (const period of months) {
    const report = await getTrafficReport(period);
    for (const row of report.rows) {
      const entry = perDevice.get(row.deviceId);
      if (!entry) {
        perDevice.set(row.deviceId, {
          deviceId: row.deviceId,
          deviceName: row.deviceName,
          group: row.group,
          area: row.area,
          downloadGb: row.downloadGb,
          uploadGb: row.uploadGb,
          avgMbpsSum: row.avgMbps,
          peakMbps: row.peakMbps,
          monthsCounted: 1,
        });
      } else {
        entry.downloadGb += row.downloadGb;
        entry.uploadGb += row.uploadGb;
        entry.avgMbpsSum += row.avgMbps;
        entry.peakMbps = Math.max(entry.peakMbps, row.peakMbps);
        entry.monthsCounted += 1;
      }
    }
  }

  const rows = [...perDevice.values()]
    .map(({ avgMbpsSum, monthsCounted, ...rest }) => ({
      ...rest,
      avgMbps: Math.round(avgMbpsSum / monthsCounted),
    }))
    .sort((a, b) => b.downloadGb - a.downloadGb);

  return {
    from,
    to,
    months: months.length,
    rows,
    summary: {
      devices: rows.length,
      totalDownloadGb: rows.reduce((sum, row) => sum + row.downloadGb, 0),
      totalUploadGb: rows.reduce((sum, row) => sum + row.uploadGb, 0),
    },
  };
}

export async function getTrafficReport(period: string) {
  await seedTrafficIfMissing(period);

  const rawRows = await db
    .select({
      deviceId: trafficMonthly.assetId,
      deviceName: assets.displayName,
      vendor: assets.vendor,
      networkRole: assets.networkRole,
      area: assets.site,
      downloadGb: trafficMonthly.downloadGb,
      uploadGb: trafficMonthly.uploadGb,
      avgMbps: trafficMonthly.avgMbps,
      peakMbps: trafficMonthly.peakMbps,
    })
    .from(trafficMonthly)
    .innerJoin(assets, eq(trafficMonthly.assetId, assets.assetId))
    .where(eq(trafficMonthly.period, period));

  const rows = rawRows
    .map(({ vendor, networkRole, ...row }) => ({
      ...row,
      group: legacyGroup(networkRole, vendor),
    }))
    .sort((a, b) => b.downloadGb - a.downloadGb);

  return {
    period,
    rows,
    summary: {
      devices: rows.length,
      totalDownloadGb: rows.reduce((sum, row) => sum + row.downloadGb, 0),
      totalUploadGb: rows.reduce((sum, row) => sum + row.uploadGb, 0),
    },
  };
}
