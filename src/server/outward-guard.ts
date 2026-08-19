// Penjaga aksi keluar — mode baca-saja.
//
// Portal NOC boleh menulis ke database SENDIRI (insiden, sesi, audit, topologi)
// tetapi TIDAK boleh bertindak keluar: mengirim notifikasi ke orang, atau
// mendorong data ke sistem lain. Alasannya operasional, bukan teknis —
// operasional sungguhan PerumNet masih di perumnet.alus.co.id, dan dua sistem
// yang bertindak sendiri-sendiri membuat pelanggan menerima dua perlakuan yang
// tidak saling tahu. Perinciannya di docs/MODE-BACA-SAJA.md.
//
// BAWAANNYA MEMBLOKIR, dan itu disengaja. Tidak diisi → diblokir. Salah ketik →
// diblokir. Kebalikannya (blokir hanya bila diminta) mengulang kesalahan yang
// sudah ada di CRM: di sana `enabledByDefault: true` membuat database baru
// menyalakan sendiri lima pekerjaan yang seharusnya mati. Di sini VPS baru,
// container baru, atau .env yang dipulihkan dari cadangan lama semuanya naik
// dalam keadaan terkunci.
//
// Bentuk pembacaan env meniru authProviderMode() di src/server/mail-auth.ts:
// dibaca SAAT DIPANGGIL (bukan saat modul dimuat, supaya bisa di-stub di tes),
// dirapikan, lalu nilai tak dikenal jatuh ke pilihan yang aman.

import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";

/** Aksi keluar yang dikenal. Menambah anggota = keputusan sadar; dipatok oleh
 *  tests/no-outward-fetch-guard.test.ts supaya terlihat saat review. */
export type OutwardAction = "crm-webhook" | "telegram" | "whatsapp";

export type OutwardMode = "ALLOWED" | "BLOCKED";

export class OutwardBlockedError extends Error {
  readonly action: OutwardAction;

  constructor(action: OutwardAction) {
    super(`Aksi keluar "${action}" ditahan: portal sedang dalam mode baca-saja.`);
    this.name = "OutwardBlockedError";
    this.action = action;
  }
}

/** ALLOWED hanya bila OUTWARD_ACTIONS bernilai persis "ALLOWED"; selain itu BLOCKED. */
export function outwardMode(): OutwardMode {
  const raw = (process.env.OUTWARD_ACTIONS ?? "BLOCKED").trim().toUpperCase();
  return raw === "ALLOWED" ? "ALLOWED" : "BLOCKED";
}

export function isOutwardBlocked(): boolean {
  return outwardMode() === "BLOCKED";
}

/** Kanal yang AKAN bertindak keluar seandainya mode ALLOWED. Diturunkan dari
 *  ADA/TIDAKNYA env — tidak pernah memuat URL maupun token. */
export function configuredOutwardChannels(): Record<OutwardAction, boolean> {
  return {
    "crm-webhook": Boolean(process.env.CRM_WEBHOOK_URL?.trim()),
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()),
    whatsapp: Boolean(process.env.WHATSAPP_API_URL?.trim()),
  };
}

/**
 * SATU-SATUNYA jalan keluar HTTP dari src/server/**, selain librenmsFetch
 * (baca-saja) dan probe IMAP di mail-auth. Melempar OutwardBlockedError saat
 * mode BLOCKED — pemanggil yang fire-and-forget wajib memeriksa
 * `isOutwardBlocked()` lebih dulu; lemparan ini adalah jaring pengaman
 * terakhir, bukan alur normal.
 */
export async function outwardFetch(
  action: OutwardAction,
  url: string | URL,
  init?: RequestInit,
): Promise<Response> {
  if (isOutwardBlocked()) throw new OutwardBlockedError(action);
  return fetch(url, init);
}

/**
 * Catat satu baris jejak bahwa sebuah aksi keluar ditahan.
 *
 * TIDAK PERNAH melempar: dipanggil dari jalur fire-and-forget (webhook ingress
 * LibreNMS), dan gangguan database tidak boleh mengubah "tertahan" menjadi
 * "ingress-nya jatuh".
 */
export async function recordOutwardBlocked(
  action: OutwardAction,
  entity: { type: string; id: string },
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      id: randomUUID(),
      actorUserId: null,
      actorLabel: "system:outward-guard",
      action: "outward.blocked",
      entityType: entity.type,
      entityId: entity.id,
      detail: { outwardAction: action, mode: "BLOCKED", ...detail },
      createdAt: new Date(),
    });
  } catch (error) {
    console.error(
      `[outward-guard] gagal mencatat penahanan ${action}:`,
      error instanceof Error ? error.message : error,
    );
  }
}
