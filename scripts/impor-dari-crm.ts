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
    // `credentialRef` IKUT dibawa. Ia NAMA env var, bukan kata sandinya — dan
    // justru itu yang membuat portal tahu env mana yang harus diisi. Kata
    // sandinya sendiri tidak pernah keluar dari env server.
    //
    // `site_id` sengaja TIDAK disentuh: CRM tidak punya kolomnya, jadi
    // menuliskannya di sini berarti menimpa tautan situs yang sudah benar
    // dengan null setiap kali impor dijalankan.
    const olt = nol();
    /** id OLT di CRM → id OLT di NOC, dipakai saat menautkan ODP. */
    const petaOlt = new Map<string, string>();
    const rOlt = await crm.query<{
      id: string; name: string; managementIp: string; vendor: string | null;
      model: string | null; telnetPort: number | null; credentialRef: string | null;
    }>(`SELECT id, name, "managementIp", vendor, model, "telnetPort", "credentialRef" FROM "OltDevice"`);

    for (const o of rOlt.rows) {
      const ada = await noc.query<{ id: string }>(
        "SELECT id FROM olt_devices WHERE name = $1", [o.name]);
      if (ada.rows[0]) petaOlt.set(o.id, ada.rows[0].id);
      if (ada.rows[0]) {
        // `management_ip` dan `telnet_port` sengaja TIDAK disentuh saat
        // memperbarui — alasannya sama dengan `site_id` di atas, tapi
        // akibatnya lebih mahal.
        //
        // CRM menyimpan alamat jalur port-forwarding ALUS (172.30.10.x).
        // Portal ini hidup SATU JARINGAN dengan OLT-nya, jadi alamat itu
        // tidak pernah bisa dihubunginya: diuji dari VPS 22 Agustus 2026,
        // 172.30.10.6 port 23/231/1024 tidak menjawab satu pun, sedangkan
        // keenam alamat LAN menjawab semua.
        //
        // Sebelum ini importir menimpanya tiap kali dijalankan, dan konsol
        // perangkat gagal untuk 5 dari 6 OLT — gagalnya berupa waktu-habis,
        // bukan pesan yang bisa dijelaskan. Portal ini yang tahu apa yang
        // terjangkau dari tempatnya berdiri; CRM tidak.
        //
        // Dijaga `tests/impor-crm-alamat-olt.test.ts`.
        if (!DRY) {
          await noc.query(
            `UPDATE olt_devices SET vendor=$2, model=$3, credential_ref=$4 WHERE id=$1`,
            [ada.rows[0].id, o.vendor, o.model, o.credentialRef]);
        }
        olt.diperbarui += 1;
      } else {
        const idBaru = randomUUID();
        petaOlt.set(o.id, idBaru);
        if (!DRY) {
          await noc.query(
            `INSERT INTO olt_devices (id, name, management_ip, vendor, model, telnet_port, credential_ref)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [idBaru, o.name, o.managementIp, o.vendor, o.model, o.telnetPort, o.credentialRef]);
        }
        olt.dibuat += 1;
        // OLT baru memakai alamat CRM sebagai titik awal — tidak ada sumber
        // lain. Hampir pasti alamat jalur luar, jadi ia harus diperiksa dari
        // VPS sebelum konsolnya dipakai.
        console.log(
          `  ! OLT baru ${o.name} memakai alamat CRM (${o.managementIp}:${o.telnetPort ?? "-"}).` +
          " Periksa dari VPS; kemungkinan besar butuh alamat LAN.",
        );
      }
    }
    console.log(`  OLT        : ${olt.dibuat} baru, ${olt.diperbarui} diperbarui`);

    // ── ODP ──────────────────────────────────────────────────────────────
    // CRM tidak punya kolom `name` pada Odp — kodenya dipakai untuk keduanya.
    //
    // ODP mana milik OLT mana TIDAK perlu ditebak: CRM menyimpannya lewat
    // `Odp.ponPortId` → `PonPort.oltId`. Itu penting karena satu situs bisa
    // punya lebih dari satu OLT (Kecicang punya dua), sehingga menebak dari
    // situs saja pasti salah untuk sebagian ODP.
    //
    // LEFT JOIN, bukan JOIN: ODP tanpa PON port tetap harus ikut terimpor
    // dengan `olt_id` kosong. Kalau dipakai JOIN, ODP seperti itu hilang
    // diam-diam dari portal — dan hilangnya tidak menghasilkan galat apa pun.
    const odp = nol();
    const petaOdp = new Map<string, string>();
    let odpTanpaOlt = 0;
    const rOdp = await crm.query<{
      id: string; code: string; siteId: string | null; portCapacity: number | null;
      latitude: number | null; longitude: number | null; oltId: string | null;
      role: string | null; parentId: string | null; status: string | null;
    }>(`SELECT d.id, d.code, d."siteId", d."portCapacity", d.latitude, d.longitude,
               d.role, d."parentId", d.status,
               p."oltId"
          FROM "Odp" d
          LEFT JOIN "PonPort" p ON p.id = d."ponPortId"`);

    for (const o of rOdp.rows) {
      const kode = o.code.trim().toUpperCase();
      const siteId = o.siteId ? petaSitus.get(o.siteId) ?? null : null;
      const oltId = o.oltId ? petaOlt.get(o.oltId) ?? null : null;
      if (!oltId) odpTanpaOlt += 1;
      const kapasitas = o.portCapacity ?? 8;
      // `role` hanya boleh MS atau ODP; nilai lain diperlakukan ODP, sama
      // seperti bawaan kolomnya. Nilai asing dari CRM tidak boleh menyelinap.
      const peran = o.role?.trim().toUpperCase() === "MS" ? "MS" : "ODP";
      const ada = await noc.query<{ id: string }>("SELECT id FROM odps WHERE code = $1", [kode]);
      if (ada.rows[0]) {
        petaOdp.set(o.id, ada.rows[0].id);
        if (!DRY) {
          await noc.query(
            `UPDATE odps SET name=$2, site_id=$3, capacity=$4, latitude=$5, longitude=$6, olt_id=$7, role=$8, status=$9 WHERE id=$1`,
            [ada.rows[0].id, kode, siteId, kapasitas, o.latitude, o.longitude, oltId, peran, o.status]);
        }
        odp.diperbarui += 1;
      } else {
        const id = randomUUID();
        petaOdp.set(o.id, id);
        if (!DRY) {
          await noc.query(
            `INSERT INTO odps (id, code, name, site_id, capacity, latitude, longitude, olt_id, role, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [id, kode, kode, siteId, kapasitas, o.latitude, o.longitude, oltId, peran, o.status]);
        }
        odp.dibuat += 1;
      }
    }

    // Induk kaskade DITUNDA ke lintasan kedua: sebuah ODP bisa menyebut induk
    // yang barisnya baru dibuat sesudahnya. Menautkannya di lintasan pertama
    // berarti sebagian tautan hilang tergantung urutan baris — dan hilangnya
    // tidak menghasilkan galat apa pun.
    let indukTertaut = 0;
    let indukTidakDikenal = 0;
    for (const o of rOdp.rows) {
      if (!o.parentId) continue;
      const anak = petaOdp.get(o.id);
      const induk = petaOdp.get(o.parentId);
      if (!anak) continue;
      if (!induk) {
        indukTidakDikenal += 1;
        continue;
      }
      if (anak === induk) continue; // ODP tidak boleh jadi induk dirinya sendiri
      if (!DRY) {
        await noc.query("UPDATE odps SET parent_id=$2 WHERE id=$1", [anak, induk]);
      }
      indukTertaut += 1;
    }
    console.log(
      `  kaskade    : ${indukTertaut} induk tertaut` +
        (indukTidakDikenal ? `, ${indukTidakDikenal} induk tidak dikenal` : ""),
    );
    console.log(
      `  ODP        : ${odp.dibuat} baru, ${odp.diperbarui} diperbarui` +
        (odpTanpaOlt ? `, ${odpTanpaOlt} tanpa OLT` : ""),
    );

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

    // ── Pelanggan per ODP ────────────────────────────────────────────────
    // HANYA username PPPoE dan ID langganan. Tidak ada nama, alamat, nomor,
    // maupun koordinat — repo ini publik, dan koordinat rumah adalah penanda
    // yang lebih kuat daripada nama.
    //
    // `status` WAJIB ikut, dan bukan kelengkapan: dari 1.687 langganan yang
    // menempel ODP, 113 berstatus ISOLATED/INACTIVE/PROSPECT. Mereka memang
    // tidak online, selamanya. Tanpa kolom ini, satu ODP dengan 3 pelanggan
    // terisolir akan terus-menerus dilaporkan sebagai gangguan massal — dan
    // fitur itu mati sebelum sempat dipakai.
    const pel = nol();
    let pelTanpaOdp = 0;
    const rPel = await crm.query<{
      odpId: string; portNumber: number; subscriptionId: string;
      pppoeUsername: string; status: string;
    }>(`SELECT p."odpId", p."portNumber", p."subscriptionId",
               s."pppoeUsername", s.status
          FROM "OdpPort" p
          JOIN "Subscription" s ON s.id = p."subscriptionId"
         WHERE s."pppoeUsername" IS NOT NULL`);

    for (const c of rPel.rows) {
      const odpId = petaOdp.get(c.odpId);
      if (!odpId) {
        pelTanpaOdp += 1;
        continue;
      }
      const username = c.pppoeUsername.trim().toLowerCase();
      if (!username) continue;
      const ada = await noc.query<{ id: string }>(
        "SELECT id FROM odp_customers WHERE pppoe_username = $1", [username]);
      if (ada.rows[0]) {
        if (!DRY) {
          await noc.query(
            `UPDATE odp_customers SET odp_id=$2, port_number=$3, external_service_id=$4,
                    subscription_status=$5, updated_at=now() WHERE id=$1`,
            [ada.rows[0].id, odpId, c.portNumber, c.subscriptionId, c.status]);
        }
        pel.diperbarui += 1;
      } else {
        if (!DRY) {
          await noc.query(
            `INSERT INTO odp_customers (id, odp_id, port_number, pppoe_username,
                    external_service_id, subscription_status)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [randomUUID(), odpId, c.portNumber, username, c.subscriptionId, c.status]);
        }
        pel.dibuat += 1;
      }
    }
    console.log(
      `  pelanggan  : ${pel.dibuat} baru, ${pel.diperbarui} diperbarui` +
        (pelTanpaOdp ? `, ${pelTanpaOdp} ODP-nya tidak terimpor` : ""),
    );

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
