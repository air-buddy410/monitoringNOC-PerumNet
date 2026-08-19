// Pemantau kesegaran cadangan — PASIF.
//
// Malam 19 Agustus 2026 mengajarkan dua hal sekaligus. Pertama, cadangan bisa
// berhenti diam-diam: perintah cadangan CRM salah nama database selama
// berbulan-bulan dan menghasilkan berkas 30 bita yang lolos `gzip -t`. Kedua,
// pemberitahuan tidak bisa diandalkan untuk mengabarkannya: kontainer kehilangan
// jalan keluar selama ±20 menit, dan justru pada saat seperti itu kabar paling
// dibutuhkan. Pemberitahuan yang mati bersama sistem yang diawasinya bukan
// pengawasan.
//
// Karena itu modul ini MEMBACA, tidak mengirim. Ia tidak butuh jalan keluar
// sama sekali, jadi ia tetap jujur persis saat jaringan sedang rusak. Sinyalnya
// muncul di layar yang memang sudah dibuka orang tiap hari.
//
// Dasarnya `mtime` berkas cadangan TERBARU, bukan berkas status yang ditulis
// skrip cadangan. Bedanya menentukan: berkas status menjawab "kapan skrip
// terakhir sempat menulis", dan itu tidak bisa membedakan skrip yang gagal dari
// cron yang mati sama sekali. `mtime` menjawab pertanyaan yang benar — **kapan
// terakhir kita punya cadangan yang berisi.**

import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export interface BackupApp {
  key: string;
  label: string;
  /** Nama folder di dalam akar cadangan. */
  dir: string;
  /** Berkas yang dihitung sebagai cadangan basis data. */
  pattern: RegExp;
  /** Lebih tua dari ini = basi. Diberi kelonggaran atas jadwal cron-nya. */
  maxAgeHours: number;
  /** Ambang mutlak: di bawah ini pasti salah, apa pun formatnya. */
  minBytes: number;
}

/**
 * Ambangnya per-aplikasi, bukan satu angka global. Formatnya memang berbeda —
 * NOC & CRM `pg_dump | gzip`, warehouse `pg_dump -Fc`, enterprise punya polanya
 * sendiri — jadi satu ambang untuk semua akan meloloskan yang seharusnya
 * ditolak, atau sebaliknya.
 */
export const BACKUP_APPS: BackupApp[] = [
  { key: "noc", label: "Monitoring NOC", dir: "noc-portal",
    pattern: /^noc-.*\.sql\.gz$/, maxAgeHours: 30, minBytes: 1_000 },
  { key: "crm", label: "CRM", dir: "perumnet-crm",
    pattern: /^crm-.*\.sql\.gz$/, maxAgeHours: 30, minBytes: 50_000 },
  { key: "warehouse", label: "Warehouse", dir: "warehouse",
    pattern: /^perumnet_warehouse-.*\.dump$/, maxAgeHours: 30, minBytes: 10_000 },
  // Enterprise memakai `pg_dump -Fc` bernama `database-*.dump`, sementara di
  // folder yang sama ada `uploads-*.tar.gz` yang JAUH lebih besar. Pola yang
  // longgar akan mengukur tarball lampirannya dan menyatakan cadangan sehat
  // walau dump databasenya berhenti — persis kegagalan senyap yang hendak
  // ditangkap modul ini. Diperiksa ke berkas sungguhan 19 Agustus 2026.
  { key: "enterprise", label: "Enterprise", dir: "perumnet-enterprise-production",
    pattern: /^database-.*\.dump$/, maxAgeHours: 30, minBytes: 10_000 },
];

export type BackupHealth = "ok" | "basi" | "mencurigakan" | "tidak-ada";

export interface BackupStatus {
  key: string;
  label: string;
  health: BackupHealth;
  /** ISO; null bila tidak ada cadangan sama sekali. */
  latestAt: string | null;
  ageHours: number | null;
  bytes: number | null;
  /** Cadangan sebelumnya di folder yang sama, untuk membandingkan ukuran. */
  previousBytes: number | null;
  count: number;
  /** Kalimat siap tampil. */
  reason: string;
}

/** Penurunan ukuran sebesar ini dibanding cadangan sebelumnya dianggap
 *  mencurigakan. Lebih jujur daripada angka mutlak: yang penting bukan
 *  "berapa besar", tapi "kenapa tiba-tiba menyusut". */
const PENURUNAN_MENCURIGAKAN = 0.5;

function jam(ms: number): number {
  return Math.round((ms / 3_600_000) * 10) / 10;
}

async function periksaSatu(
  root: string,
  app: BackupApp,
  sekarang: number,
): Promise<BackupStatus> {
  const dasar: Omit<BackupStatus, "health" | "reason"> = {
    key: app.key,
    label: app.label,
    latestAt: null,
    ageHours: null,
    bytes: null,
    previousBytes: null,
    count: 0,
  };

  let entries: string[];
  try {
    entries = await readdir(path.join(root, app.dir));
  } catch {
    return {
      ...dasar,
      health: "tidak-ada",
      reason: `${app.label}: folder cadangan tidak ditemukan.`,
    };
  }

  const berkas: Array<{ nama: string; mtimeMs: number; size: number }> = [];
  for (const nama of entries) {
    if (!app.pattern.test(nama)) continue;
    try {
      const s = await stat(path.join(root, app.dir, nama));
      if (s.isFile()) berkas.push({ nama, mtimeMs: s.mtimeMs, size: s.size });
    } catch {
      // berkas hilang di tengah pembacaan — abaikan, bukan kegagalan
    }
  }

  if (berkas.length === 0) {
    return {
      ...dasar,
      health: "tidak-ada",
      reason: `${app.label}: belum ada cadangan sama sekali.`,
    };
  }

  berkas.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const [terbaru, sebelumnya] = berkas;
  const umur = jam(sekarang - terbaru.mtimeMs);

  const hasil: Omit<BackupStatus, "health" | "reason"> = {
    ...dasar,
    latestAt: new Date(terbaru.mtimeMs).toISOString(),
    ageHours: umur,
    bytes: terbaru.size,
    previousBytes: sebelumnya?.size ?? null,
    count: berkas.length,
  };

  if (umur > app.maxAgeHours) {
    return {
      ...hasil,
      health: "basi",
      reason: `${app.label}: cadangan terakhir ${umur} jam lalu — cron-nya kemungkinan berhenti.`,
    };
  }

  if (terbaru.size < app.minBytes) {
    return {
      ...hasil,
      health: "mencurigakan",
      reason: `${app.label}: cadangan terakhir hanya ${terbaru.size} bita — kemungkinan kosong.`,
    };
  }

  if (
    sebelumnya &&
    sebelumnya.size > 0 &&
    terbaru.size < sebelumnya.size * PENURUNAN_MENCURIGAKAN
  ) {
    return {
      ...hasil,
      health: "mencurigakan",
      reason: `${app.label}: cadangan menyusut dari ${sebelumnya.size} ke ${terbaru.size} bita.`,
    };
  }

  return {
    ...hasil,
    health: "ok",
    reason: `${app.label}: cadangan terakhir ${umur} jam lalu.`,
  };
}

/** Akar folder cadangan. Dapat ditimpa lewat env untuk pengujian & dev. */
export function backupRoot(): string {
  return (
    process.env.BACKUP_ROOT?.trim() ||
    path.join(process.env.HOME ?? "/home/perumnet", "backups")
  );
}

export async function readBackupFreshness(
  root: string = backupRoot(),
  sekarang: number = Date.now(),
): Promise<BackupStatus[]> {
  return Promise.all(BACKUP_APPS.map((app) => periksaSatu(root, app, sekarang)));
}
