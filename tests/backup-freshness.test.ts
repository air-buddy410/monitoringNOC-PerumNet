// Kesegaran cadangan dibaca dari berkas sungguhan di folder sementara —
// bukan dari mock fs, supaya yang diuji adalah perilaku yang sama dengan
// produksi (termasuk mtime dan ukuran nyata).

import { mkdtemp, mkdir, writeFile, utimes, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readBackupFreshness } from "@/server/backup-freshness";

let root: string;
const SEKARANG = new Date("2026-08-20T04:00:00Z").getTime();

async function buat(
  dir: string,
  nama: string,
  bytes: number,
  jamLalu: number,
) {
  const folder = path.join(root, dir);
  await mkdir(folder, { recursive: true });
  const berkas = path.join(folder, nama);
  await writeFile(berkas, Buffer.alloc(bytes));
  const waktu = new Date(SEKARANG - jamLalu * 3_600_000);
  await utimes(berkas, waktu, waktu);
}

function ambil(hasil: Awaited<ReturnType<typeof readBackupFreshness>>, key: string) {
  const row = hasil.find((r) => r.key === key);
  if (!row) throw new Error(`aplikasi ${key} tidak ada di hasil`);
  return row;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "uji-cadangan-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("kesegaran cadangan", () => {
  it("folder tidak ada → tidak-ada, bukan lemparan", async () => {
    const hasil = await readBackupFreshness(root, SEKARANG);
    expect(hasil).toHaveLength(4);
    expect(ambil(hasil, "noc").health).toBe("tidak-ada");
    expect(ambil(hasil, "noc").latestAt).toBeNull();
  });

  it("cadangan segar & berisi → ok", async () => {
    await buat("noc-portal", "noc-2026-08-20-0330.sql.gz", 8_000, 0.5);
    const noc = ambil(await readBackupFreshness(root, SEKARANG), "noc");
    expect(noc.health).toBe("ok");
    expect(noc.ageHours).toBe(0.5);
    expect(noc.bytes).toBe(8_000);
  });

  // Inti dari seluruh modul ini: cron yang berhenti tidak menghasilkan galat
  // apa pun — yang tersisa cuma berkas yang tidak pernah diperbarui.
  it("cadangan terakhir 3 hari lalu → basi", async () => {
    await buat("noc-portal", "noc-2026-08-17-0330.sql.gz", 8_000, 72);
    const noc = ambil(await readBackupFreshness(root, SEKARANG), "noc");
    expect(noc.health).toBe("basi");
    expect(noc.reason).toMatch(/cron/);
  });

  // Kasus yang benar-benar terjadi di CRM: berkas 30 bita yang lolos gzip -t.
  it("cadangan segar tapi 30 bita → mencurigakan", async () => {
    await buat("perumnet-crm", "crm-2026-08-20-0430.sql.gz", 30, 0.2);
    const crm = ambil(await readBackupFreshness(root, SEKARANG), "crm");
    expect(crm.health).toBe("mencurigakan");
    expect(crm.reason).toMatch(/kosong/);
  });

  it("menyusut drastis dari cadangan sebelumnya → mencurigakan", async () => {
    await buat("warehouse", "perumnet_warehouse-20260819-023000.dump", 855_000, 24);
    await buat("warehouse", "perumnet_warehouse-20260820-023000.dump", 90_000, 1.5);
    const wh = ambil(await readBackupFreshness(root, SEKARANG), "warehouse");
    expect(wh.health).toBe("mencurigakan");
    expect(wh.reason).toMatch(/menyusut/);
    expect(wh.previousBytes).toBe(855_000);
  });

  it("ambangnya per-aplikasi: 30 KB sah bagi warehouse, tidak bagi CRM", async () => {
    await buat("warehouse", "perumnet_warehouse-20260820-023000.dump", 30_000, 1.5);
    await buat("perumnet-crm", "crm-2026-08-20-0430.sql.gz", 30_000, 1.5);
    const hasil = await readBackupFreshness(root, SEKARANG);
    expect(ambil(hasil, "warehouse").health).toBe("ok");
    expect(ambil(hasil, "crm").health).toBe("mencurigakan");
  });

  it("berkas yang tidak cocok pola diabaikan", async () => {
    await buat("noc-portal", "catatan.txt", 8_000, 0.5);
    await buat("noc-portal", "noc-2026-08-20-0330.sql.gz.part", 8_000, 0.5);
    expect(ambil(await readBackupFreshness(root, SEKARANG), "noc").health).toBe(
      "tidak-ada",
    );
  });

  it("yang terbaru dipakai, bukan yang pertama dibaca", async () => {
    await buat("noc-portal", "noc-2026-08-18-0330.sql.gz", 9_000, 48);
    await buat("noc-portal", "noc-2026-08-20-0330.sql.gz", 8_000, 0.5);
    const noc = ambil(await readBackupFreshness(root, SEKARANG), "noc");
    expect(noc.health).toBe("ok");
    expect(noc.count).toBe(2);
    expect(noc.previousBytes).toBe(9_000);
  });
});

describe("pola nama berkas dicocokkan ke berkas produksi sungguhan", () => {
  // Enterprise menyimpan dump database DAN tarball lampiran di folder yang
  // sama, dan tarballnya jauh lebih besar. Pola yang longgar akan mengukur
  // lampirannya lalu menyatakan cadangan sehat walau dump databasenya berhenti.
  it("enterprise: lampiran tidak boleh menyamar jadi cadangan database", async () => {
    await buat("perumnet-enterprise-production", "uploads-20260820T033000Z.tar.gz", 40_000_000, 0.5);
    await buat("perumnet-enterprise-production", "database-20260817T033000Z.dump", 900_000, 72);
    const ent = ambil(await readBackupFreshness(root, SEKARANG), "enterprise");
    expect(ent.health).toBe("basi");
    expect(ent.bytes).toBe(900_000);
  });

  it.each([
    ["noc", "noc-portal", "noc-2026-08-19-2126.sql.gz"],
    ["crm", "perumnet-crm", "crm-2026-08-19-2140.sql.gz"],
    ["warehouse", "warehouse", "perumnet_warehouse-20260819-215557.dump"],
    ["enterprise", "perumnet-enterprise-production", "database-20260819T135248Z.dump"],
  ])("%s mengenali nama berkas produksi", async (key, dir, nama) => {
    await buat(dir, nama, 900_000, 1);
    expect(ambil(await readBackupFreshness(root, SEKARANG), key).health).toBe("ok");
  });

  it("cadangan CRM lama (cadangan-*.sql.gz) tidak dihitung sebagai yang terjadwal", async () => {
    await buat("perumnet-crm", "cadangan-2026-08-19-2111.sql.gz", 1_900_000, 0.5);
    expect(ambil(await readBackupFreshness(root, SEKARANG), "crm").health).toBe("tidak-ada");
  });
});
