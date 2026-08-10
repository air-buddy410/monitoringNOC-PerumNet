#!/usr/bin/env node
// Impor aset dari LibreNMS ke tabel `assets` (Portal NOC PerumNet).
//
// Pakai:
//   LIBRENMS_URL=https://nms.perumnet.id LIBRENMS_TOKEN=... \
//     node scripts/import-librenms-assets.mjs          # dry-run (default)
//   ... node scripts/import-librenms-assets.mjs --commit  # tulis ke DB
//
// Target DB: DATABASE_URL (PostgreSQL) bila di-set, selain itu PGlite pada
// PGLITE_DIR (default ./data/pglite). PGlite bersifat single-process —
// jalankan saat dev server TIDAK berjalan (lihat docs/DB_MIGRATION.md).
//
// Sifat: idempoten (upsert per asset_id); tidak pernah menghapus aset.
// Token hanya dibaca dari environment — tidak pernah ditulis ke file/commit.
// network_role hasil tebakan (lihat inferNetworkRole) WAJIB ditinjau operator.

import { planAssetImport } from "./librenms-asset-import-lib.mjs";

const commit = process.argv.includes("--commit");

async function fetchDevices() {
  const url = process.env.LIBRENMS_URL;
  const token = process.env.LIBRENMS_TOKEN;
  if (!url || !token) {
    throw new Error("LIBRENMS_URL dan LIBRENMS_TOKEN wajib di-set di environment.");
  }
  const endpoint = `${url.replace(/\/+$/, "")}/api/v0/devices?type=all`;
  const response = await fetch(endpoint, {
    headers: { "X-Auth-Token": token, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`LibreNMS menjawab HTTP ${response.status} untuk ${endpoint}`);
  }
  const body = await response.json();
  return body.devices ?? [];
}

async function openTarget() {
  if (process.env.DATABASE_URL) {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    return {
      label: `PostgreSQL (${new URL(process.env.DATABASE_URL).host})`,
      query: (text, params) => client.query(text, params),
      close: () => client.end(),
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.PGLITE_DIR ?? "./data/pglite";
  const client = new PGlite(dir);
  return {
    label: `PGlite (${dir})`,
    query: (text, params) => client.query(text, params),
    close: () => client.close(),
  };
}

const ASSET_COLUMNS = [
  "asset_id",
  "librenms_device_id",
  "hostname",
  "display_name",
  "management_ip",
  "vendor",
  "os",
  "model",
  "serial_number",
  "site",
  "location",
  "latitude",
  "longitude",
  "tags",
  "network_role",
];

const UPSERT_SQL = `INSERT INTO assets (${ASSET_COLUMNS.join(", ")})
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
ON CONFLICT (asset_id) DO UPDATE SET
  librenms_device_id = EXCLUDED.librenms_device_id,
  hostname = EXCLUDED.hostname,
  display_name = EXCLUDED.display_name,
  management_ip = EXCLUDED.management_ip,
  vendor = EXCLUDED.vendor,
  os = EXCLUDED.os,
  model = EXCLUDED.model,
  serial_number = EXCLUDED.serial_number,
  site = EXCLUDED.site,
  location = EXCLUDED.location,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  tags = EXCLUDED.tags,
  network_role = EXCLUDED.network_role,
  updated_at = now()`;

function toValues(assetId, row) {
  return [
    assetId,
    row.librenms_device_id,
    row.hostname,
    row.display_name,
    row.management_ip,
    row.vendor,
    row.os,
    row.model,
    row.serial_number,
    row.site,
    row.location,
    row.latitude,
    row.longitude,
    JSON.stringify(row.tags),
    row.network_role,
  ];
}

async function loadExisting(target) {
  const result = await target.query(
    "SELECT asset_id, librenms_device_id, hostname, display_name, management_ip, vendor, os, model, serial_number, site, location, latitude, longitude, network_role FROM assets",
  );
  const rows = result.rows ?? [];
  const byAssetId = new Map();
  const byLibDeviceId = new Map();
  for (const row of rows) {
    byAssetId.set(row.asset_id, row);
    if (row.librenms_device_id != null) {
      byLibDeviceId.set(Number(row.librenms_device_id), row.asset_id);
    }
  }
  return { byAssetId, byLibDeviceId };
}

const devices = await fetchDevices();

console.log(`LibreNMS : ${process.env.LIBRENMS_URL} (${devices.length} device ditemukan)`);
console.log("");

if (devices.length === 0) {
  console.log("Tidak ada device di LibreNMS — tidak ada yang diimpor. Tambahkan device");
  console.log("terlebih dahulu (SNMP discovery/polling), lalu jalankan ulang.");
  process.exit(0);
}

let target;
try {
  target = await openTarget();
} catch (error) {
  console.error(
    "Tidak dapat membuka database target. PGlite bersifat single-process: pastikan",
    "dev server / aplikasi TIDAK berjalan, atau set DATABASE_URL ke PostgreSQL.",
  );
  console.error(`Penyebab: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const { byAssetId, byLibDeviceId } = await loadExisting(target);

console.log(`Target   : ${target.label}`);
console.log(`Mode     : ${commit ? "COMMIT (menulis ke DB)" : "dry-run (tidak menulis)"}`);
console.log("");

const plan = planAssetImport(devices, byAssetId, byLibDeviceId);

for (const warning of plan.warnings) console.log(`! ${warning}`);
console.log(
  `Rencana: ${plan.toInsert.length} baru, ${plan.toUpdate.length} update, ${plan.unchanged.length} tidak berubah, ${plan.warnings.length} dilewati`,
);
console.log("");

for (const { assetId, row } of plan.toInsert) {
  console.log(`+ ${assetId}  ${row.display_name}  (${row.vendor} / ${row.os ?? "-"} / ${row.network_role})`);
  console.log(`    ip=${row.management_ip}  site=${row.site}`);
}
for (const { assetId, changes } of plan.toUpdate) {
  const fields = Object.keys(changes).join(", ");
  console.log(`~ ${assetId}  update: ${fields}`);
}
if (plan.toInsert.length > 0 || plan.toUpdate.length > 0) {
  console.log("");
  console.log("PENTING: network_role & site adalah tebakan dari metadata LibreNMS —");
  console.log("tinjau per aset sebelum operasional (lihat PRD, override manual diaudit).");
}

if (!commit) {
  console.log("\nDry-run selesai — jalankan dengan --commit untuk menulis ke database.");
  await target.close();
  process.exit(0);
}
let inserted = 0;
let updated = 0;
for (const { assetId, row } of plan.toInsert) {
  const result = await target.query(UPSERT_SQL, toValues(assetId, row));
  inserted += (result.rowCount ?? result.affectedRows ?? 1) > 0 ? 1 : 0;
}
for (const { assetId, row } of plan.toUpdate) {
  await target.query(UPSERT_SQL, toValues(assetId, row));
  updated += 1;
}

console.log(`\nSelesai: ${inserted} aset baru, ${updated} aset diperbarui.`);
await target.close();
