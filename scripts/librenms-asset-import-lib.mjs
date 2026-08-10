// Pustaka transformasi murni untuk impor aset dari LibreNMS → tabel `assets`.
// Dipisah dari skrip CLI agar dapat diuji unit (tests/librenms-asset-import.test.ts),
// mengikuti pola scripts/migrate-lib.mjs. Tanpa I/O — HTTP ada di CLI, tulis DB di CLI.

/** ID aset deterministik: `lnms-<device_id>` — unik & bisa dipetakan ulang. */
export function assetIdFromDeviceId(deviceId) {
  return `lnms-${deviceId}`;
}

const VENDOR_BY_OS = {
  routeros: "MikroTik",
  swos: "MikroTik",
  zxa10: "ZTE",
  ruijie: "Ruijie",
  ubiquiti: "Ubiquiti",
  airos: "Ubiquiti",
  edgeos: "Ubiquiti",
  junos: "Juniper",
  ios: "Cisco",
  cisco: "Cisco",
  iosxe: "Cisco",
  nxos: "Cisco",
  vyos: "VyOS",
  linux: "Linux",
  debian: "Debian",
  ubuntu: "Ubuntu",
  centos: "CentOS",
  fortios: "Fortinet",
  paloalto: "Palo Alto",
  huawei: "Huawei",
  h3c: "H3C",
};

/** Vendor tebakan dari OS LibreNMS; fallback "Unknown" (operator dapat koreksi). */
export function vendorFromOs(os) {
  const key = String(os ?? "")
    .trim()
    .toLowerCase();
  if (!key) return "Unknown";
  return VENDOR_BY_OS[key] ?? "Unknown";
}

/**
 * Role jaringan tebakan dari metadata LibreNMS. Hanya tebakan berbasis bukti
 * (OS OLT, tipe server); selainnya default `access` — operator WAJIB meninjau
 * (lihat docs/PROMPT_CLAUDE_IMPLEMENTASI_LIBRENMS.md, pemetaan manual + audit).
 */
export function inferNetworkRole(device) {
  const os = String(device.os ?? "").toLowerCase();
  const type = String(device.type ?? "").toLowerCase();
  if (os === "zxa10" || os.includes("zxan") || os.includes("c320") || os.includes("c300")) return "olt";
  if (type === "server" || os === "linux" || os === "debian" || os === "ubuntu" || os === "centos") {
    return "server";
  }
  if (os === "routeros") return "distribution";
  return "access";
}

/**
 * Baris kolom `assets` dari satu device LibreNMS; null bila identitas tidak
 * bisa ditentukan (hostname & sysName kosong). `management_ip` fallback ke
 * hostname karena kolom DB notNull.
 */
export function buildAssetFromDevice(device) {
  const hostname = String(device.hostname ?? "").trim();
  const sysName = String(device.sysName ?? "").trim();
  if (!hostname && !sysName) return null;

  const name = sysName || hostname;
  const managementIp = String(device.overwrite_ip ?? device.ip ?? "").trim() || hostname;
  const site = String(device.location ?? "").trim() || "Unassigned";

  return {
    librenms_device_id: Number(device.device_id),
    hostname: hostname || sysName,
    display_name: name,
    management_ip: managementIp,
    vendor: vendorFromOs(device.os),
    os: device.os ?? null,
    model: device.hardware ?? null,
    serial_number: device.serial ?? null,
    site,
    location: device.location ?? null,
    latitude: numberOrNull(device.lat),
    longitude: numberOrNull(device.lng),
    tags: [],
    network_role: inferNetworkRole(device),
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Kunci field yang dibandingkan untuk deteksi perubahan. */
const COMPARED_FIELDS = [
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
  "network_role",
];

function rowDiff(current, incoming) {
  const changes = {};
  for (const field of COMPARED_FIELDS) {
    if (String(current[field] ?? "") !== String(incoming[field] ?? "")) {
      changes[field] = { from: current[field] ?? null, to: incoming[field] ?? null };
    }
  }
  return changes;
}

/**
 * Susun rencana impor idempoten.
 * - `existingByAssetId`: Map asset_id → baris existing (kolom ditanyakan).
 * - `existingByLibDeviceId`: Map librenms_device_id → asset_id (deteksi bentrok
 *   unique constraint; aset bentrok tidak boleh di-klaim).
 * Mengembalikan { toInsert, toUpdate, unchanged, warnings }.
 */
export function planAssetImport(devices, existingByAssetId, existingByLibDeviceId) {
  const toInsert = [];
  const toUpdate = [];
  const unchanged = [];
  const warnings = [];

  for (const device of devices) {
    const row = buildAssetFromDevice(device);
    if (!row) {
      warnings.push(`device ${device.device_id} (${device.hostname ?? "-"}): hostname & sysName kosong — dilewati`);
      continue;
    }
    const assetId = assetIdFromDeviceId(device.device_id);
    const current = existingByAssetId.get(assetId);
    const claimedBy = existingByLibDeviceId.get(row.librenms_device_id);

    if (claimedBy && claimedBy !== assetId) {
      // Aset lain sudah memakai librenms_device_id ini → jangan di-klaim.
      warnings.push(
        `device ${device.device_id}: librenms_device_id sudah dipakai aset ${claimedBy} — dilewati`,
      );
      continue;
    }

    if (!current) {
      toInsert.push({ assetId, row });
      continue;
    }

    const changes = rowDiff(current, row);
    if (Object.keys(changes).length === 0) {
      unchanged.push(assetId);
    } else {
      toUpdate.push({ assetId, row, changes });
    }
  }

  return { toInsert, toUpdate, unchanged, warnings };
}
