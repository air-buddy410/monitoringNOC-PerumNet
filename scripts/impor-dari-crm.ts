// Impor data jaringan dari CRM ke portal NOC.
//
// Alasannya sederhana: CRM sudah memuat 6 situs, 24 subnet, 577 ODP, 8.632
// port, dan 6 OLT yang dimasukkan orang dengan susah payah. Meminta orang yang
// sama mengisinya ulang di portal ini bukan pekerjaan, itu pemborosan.
//
// SIFATNYA:
// - **Baca-saja terhadap CRM.** Tidak satu pun perintah tulis dikirim ke sana.
// - **Idempoten.** Kunci alaminya (`code`, `cidr`) dipakai untuk memperbarui
//   baris yang sudah ada, bukan menumpuk duplikat. Aman dijalankan berulang.
// - **Tidak membawa identitas pelanggan.** Repo ini publik. Yang diambil dari
//   `OdpPort` hanya `subscriptionId` — sebuah ID di sistem lain, bukan nama,
//   alamat, atau nomor. Kalau kelak CRM menambah kolom nama pelanggan, skrip
//   ini TIDAK boleh ikut mengambilnya.
//
// PEMAKAIAN:
//   CRM_DATABASE_URL=postgres://…/perumnet_crm npm run impor:crm
//   tambahkan --dry-run untuk melihat tanpa menulis apa pun.

import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Client } from "pg";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

const DRY = process.argv.includes("--dry-run");

function wajib(nama: string): string {
  const v = process.env[nama]?.trim();
  if (!v) {
    console.error(`[impor] ${nama} kosong. Isi dulu; skrip ini tidak menebak alamat database.`);
    process.exit(1);
  }
  return v;
}

interface Hitung { dibuat: number; diperbarui: number }
const nol = (): Hitung => ({ dibuat: 0, diperbarui: 0 });

async function main() {
  const crmUrl = wajib("CRM_DATABASE_URL");
  const nocUrl = wajib("DATABASE_URL");

  const crm = new Client({ connectionString: crmUrl });
  const noc = new Client({ connectionString: nocUrl });
  await crm.connect();
  await noc.connect();

  console.log(`[impor] mulai${DRY ? " (DRY RUN — tidak menulis apa pun)" : ""}`);

  try {
    // ── Situs ────────────────────────────────────────────────────────────
    const situs = nol();
    const petaSitus = new Map<string, string>(); // id CRM → id NOC
    const rSitus = await crm.query<{
      id: string; siteCode: string; name: string; address: string | null;
      latitude: number | null; longitude: number | null; notes: string | null;
    }>(`SELECT id, "siteCode", name, address, latitude, longitude, notes FROM "NetworkSite"`);

    for (const s of rSitus.rows) {
      const kode = s.siteCode.trim().toUpperCase();
      const ada = await noc.query<{ id: string }>(
        "SELECT id FROM network_sites WHERE code = $1", [kode]);
      if (ada.rows[0]) {
        petaSitus.set(s.id, ada.rows[0].id);
        if (!DRY) {
          await noc.query(
            `UPDATE network_sites SET name=$2, address=$3, latitude=$4, longitude=$5, notes=$6 WHERE id=$1`,
            [ada.rows[0].id, s.name, s.address, s.latitude, s.longitude, s.notes]);
        }
        situs.diperbarui += 1;
      } else {
        const id = randomUUID();
        petaSitus.set(s.id, id);
        if (!DRY) {
          await noc.query(
            `INSERT INTO network_sites (id, code, name, address, latitude, longitude, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [id, kode, s.name, s.address, s.latitude, s.longitude, s.notes]);
        }
        situs.dibuat += 1;
      }
    }
    console.log(`  situs      : ${situs.dibuat} baru, ${situs.diperbarui} diperbarui`);

    // ── Subnet ───────────────────────────────────────────────────────────
    const subnet = nol();
    const rSubnet = await crm.query<{
      cidr: string; name: string; gateway: string | null; vlan: number | null;
      purpose: string | null; siteId: string | null;
    }>(`SELECT cidr, name, gateway, vlan, purpose, "siteId" FROM "Subnet"`);

    for (const s of rSubnet.rows) {
      const siteId = s.siteId ? petaSitus.get(s.siteId) ?? null : null;
      const ada = await noc.query<{ id: string }>("SELECT id FROM subnets WHERE cidr = $1", [s.cidr]);
      if (ada.rows[0]) {
        if (!DRY) {
          await noc.query(
            `UPDATE subnets SET name=$2, gateway=$3, vlan_id=$4, purpose=$5, site_id=$6 WHERE id=$1`,
            [ada.rows[0].id, s.name, s.gateway, s.vlan, s.purpose, siteId]);
        }
        subnet.diperbarui += 1;
      } else {
        if (!DRY) {
          await noc.query(
            `INSERT INTO subnets (id, cidr, name, gateway, vlan_id, purpose, site_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [randomUUID(), s.cidr, s.name, s.gateway, s.vlan, s.purpose, siteId]);
        }
        subnet.dibuat += 1;
      }
    }
    console.log(`  subnet     : ${subnet.dibuat} baru, ${subnet.diperbarui} diperbarui`);

    // ── OLT ──────────────────────────────────────────────────────────────
    // `credentialRef` SENGAJA tidak diambil: itu penunjuk ke kredensial, dan
    // repo ini publik. Kredensial tetap tinggal di CRM.
    const olt = nol();
    // `credentialRef` adalah NAMA env var, bukan kata sandinya — aman dibawa,
    // dan justru itu yang membuat portal tahu env mana yang harus diisi.
    const rOlt = await crm.query<{
      name: string; managementIp: string; vendor: string | null; model: string | null;
      telnetPort: number | null; credentialRef: string | null;
    }>(`SELECT name, "managementIp", vendor, model, "telnetPort", "credentialRef" FROM "OltDevice"`);

    for (const o of rOlt.rows) {
      const ada = await noc.query<{ id: string }>(
        "SELECT id FROM olt_devices WHERE name = $1", [o.name]);
      if (ada.rows[0]) {
        if (!DRY) {
          await noc.query(
            `UPDATE olt_devices SET management_ip=$2, vendor=$3, model=$4, telnet_port=$5, credential_ref=$6 WHERE id=$1`,
            [ada.rows[0].id, o.managementIp, o.vendor, o.model, o.telnetPort, o.credentialRef]);
        }
        olt.diperbarui += 1;
      } else {
        if (!DRY) {
          await noc.query(
            `INSERT INTO olt_devices (id, name, management_ip, vendor, model, telnet_port, credential_ref)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [randomUUID(), o.name, o.managementIp, o.vendor, o.model, o.telnetPort, o.credentialRef]);
        }
        olt.dibuat += 1;
      }
    }
    console.log(`  OLT        : ${olt.dibuat} baru, ${olt.diperbarui} diperbarui`);

    // ── ODP ──────────────────────────────────────────────────────────────
    // CRM tidak punya kolom `name` pada Odp — kodenya dipakai untuk keduanya.
    const odp = nol();
    const petaOdp = new Map<string, string>();
    const rOdp = await crm.query<{
      id: string; code: string; siteId: string | null; portCapacity: number | null;
      latitude: number | null; longitude: number | null;
    }>(`SELECT id, code, "siteId", "portCapacity", latitude, longitude FROM "Odp"`);

    for (const o of rOdp.rows) {
      const kode = o.code.trim().toUpperCase();
      const siteId = o.siteId ? petaSitus.get(o.siteId) ?? null : null;
      const kapasitas = o.portCapacity ?? 8;
      const ada = await noc.query<{ id: string }>("SELECT id FROM odps WHERE code = $1", [kode]);
      if (ada.rows[0]) {
        petaOdp.set(o.id, ada.rows[0].id);
        if (!DRY) {
          await noc.query(
            `UPDATE odps SET name=$2, site_id=$3, capacity=$4, latitude=$5, longitude=$6 WHERE id=$1`,
            [ada.rows[0].id, kode, siteId, kapasitas, o.latitude, o.longitude]);
        }
        odp.diperbarui += 1;
      } else {
        const id = randomUUID();
        petaOdp.set(o.id, id);
        if (!DRY) {
          await noc.query(
            `INSERT INTO odps (id, code, name, site_id, capacity, latitude, longitude)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [id, kode, kode, siteId, kapasitas, o.latitude, o.longitude]);
        }
        odp.dibuat += 1;
      }
    }
    console.log(`  ODP        : ${odp.dibuat} baru, ${odp.diperbarui} diperbarui`);

    // ── Port ODP ─────────────────────────────────────────────────────────
    // HANYA subscriptionId yang dibawa. Bukan nama, alamat, atau nomor.
    const port = nol();
    const rPort = await crm.query<{
      odpId: string; portNumber: number; status: string; subscriptionId: string | null;
    }>(`SELECT "odpId", "portNumber", status, "subscriptionId" FROM "OdpPort"`);

    const petaStatus: Record<string, string> = { FREE: "kosong", USED: "terpakai" };

    for (const p of rPort.rows) {
      const odpId = petaOdp.get(p.odpId);
      if (!odpId) continue; // ODP-nya tidak ikut terimpor
      const status = petaStatus[p.status] ?? "kosong";
      const ada = await noc.query<{ id: string }>(
        "SELECT id FROM odp_ports WHERE odp_id = $1 AND port_number = $2", [odpId, p.portNumber]);
      if (ada.rows[0]) {
        if (!DRY) {
          await noc.query(
            `UPDATE odp_ports SET status=$2, external_service_id=$3, updated_at=now() WHERE id=$1`,
            [ada.rows[0].id, status, p.subscriptionId]);
        }
        port.diperbarui += 1;
      } else {
        if (!DRY) {
          await noc.query(
            `INSERT INTO odp_ports (id, odp_id, port_number, status, external_service_id)
             VALUES ($1,$2,$3,$4,$5)`,
            [randomUUID(), odpId, p.portNumber, status, p.subscriptionId]);
        }
        port.dibuat += 1;
      }
    }
    console.log(`  port ODP   : ${port.dibuat} baru, ${port.diperbarui} diperbarui`);

    console.log(`[impor] selesai${DRY ? " (tidak ada yang ditulis)" : ""}`);
  } finally {
    await crm.end();
    await noc.end();
  }
}

main().catch((error) => {
  console.error("[impor] gagal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
