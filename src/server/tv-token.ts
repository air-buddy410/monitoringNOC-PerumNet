// Token layar TV.
//
// Pemilik memilih token di URL setelah risikonya disampaikan eksplisit.
// Berkas ini tidak mengubah pilihan itu; ia menutup semua kebocoran yang bisa
// ditutup TANPA mengubahnya:
//
//   1. Token polos tidak pernah disimpan — hanya SHA-256-nya.
//   2. Token ditempel di FRAGMEN URL (`/tv#token=…`), bukan query. Fragmen
//      tidak pernah dikirim ke server: tidak masuk access log, tidak masuk
//      log Next, dan tidak pernah muncul di header `Referer` ke pihak mana
//      pun — termasuk ke CARTO, yang melayani tile peta di layar itu.
//   3. Ditukar sekali lewat POST jadi cookie HttpOnly, lalu URL dibersihkan.
//   4. Cookie TIDAK memuat tokennya, hanya rujukan bertanda tangan.
//   5. Pencabutan berlaku SEKETIKA, karena tiap permintaan tetap memeriksa
//      barisnya — bukan menunggu cookie kedaluwarsa.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tvTokens } from "@/db/schema";

export const NAMA_COOKIE = "noc_tv";
export const UMUR_COOKIE_DETIK = 12 * 3600;
export const HARI_KEDALUWARSA_BAWAAN = 90;
export const HARI_KEDALUWARSA_MAKS = 365;

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function rahasia(): string {
  const s = process.env.BETTER_AUTH_SECRET?.trim();
  if (!s) throw new Error("BETTER_AUTH_SECRET belum diisi — cookie TV tidak bisa ditandatangani.");
  return s;
}

/** Nilai cookie: `<idToken>.<expEpoch>.<hmac>` — tanpa tokennya sendiri. */
export function buatNilaiCookie(tokenId: string, expEpoch: number): string {
  const isi = `${tokenId}.${expEpoch}`;
  const tanda = createHmac("sha256", rahasia()).update(isi).digest("hex");
  return `${isi}.${tanda}`;
}

/**
 * Membaca cookie dan memastikan tanda tangannya. Mengembalikan id token, atau
 * null bila cacat/kedaluwarsa.
 *
 * Perbandingannya `timingSafeEqual` — bukan `===` — supaya lama waktu jawaban
 * tidak membocorkan seberapa jauh tebakan mendekati.
 */
export function bacaNilaiCookie(
  nilai: string | undefined | null,
  now = new Date(),
): string | null {
  const bagian = (nilai ?? "").split(".");
  if (bagian.length !== 3) return null;
  const [tokenId, expStr, tanda] = bagian;
  const exp = Number(expStr);
  if (!tokenId || !Number.isFinite(exp)) return null;
  if (exp * 1000 <= now.getTime()) return null;
  const harusnya = createHmac("sha256", rahasia())
    .update(`${tokenId}.${expStr}`)
    .digest("hex");
  const a = Buffer.from(tanda, "utf8");
  const b = Buffer.from(harusnya, "utf8");
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? tokenId : null;
}

export interface TokenBaru {
  id: string;
  name: string;
  /** Ditampilkan SEKALI. Tidak pernah bisa dibaca lagi dari mana pun. */
  token: string;
  expiresAt: Date;
}

export async function buatToken(opts: {
  name: string;
  createdBy: string | null;
  expiresInDays?: number;
  now?: Date;
}): Promise<TokenBaru> {
  const now = opts.now ?? new Date();
  const hari = Math.min(
    Math.max(1, opts.expiresInDays ?? HARI_KEDALUWARSA_BAWAAN),
    HARI_KEDALUWARSA_MAKS,
  );
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const expiresAt = new Date(now.getTime() + hari * 86_400_000);
  await db.insert(tvTokens).values({
    id,
    name: opts.name.trim(),
    tokenHash: hashToken(token),
    tokenPrefix: token.slice(0, 8),
    createdBy: opts.createdBy,
    createdAt: now,
    expiresAt,
  });
  return { id, name: opts.name.trim(), token, expiresAt };
}

export type HasilVerifikasi =
  | { ok: true; id: string; name: string; expiresAt: Date }
  | { ok: false; sebab: "TIDAK_DIKENAL" | "DICABUT" | "KEDALUWARSA" };

export async function verifikasiToken(
  token: string,
  now = new Date(),
): Promise<HasilVerifikasi> {
  const [row] = await db
    .select()
    .from(tvTokens)
    .where(eq(tvTokens.tokenHash, hashToken(token)))
    .limit(1);
  if (!row) return { ok: false, sebab: "TIDAK_DIKENAL" };
  if (row.revokedAt) return { ok: false, sebab: "DICABUT" };
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, sebab: "KEDALUWARSA" };
  }
  return { ok: true, id: row.id, name: row.name, expiresAt: row.expiresAt };
}

/** Dipanggil tiap permintaan snapshot — itulah yang membuat pencabutan seketika. */
export async function tokenMasihBerlaku(
  tokenId: string,
  now = new Date(),
): Promise<boolean> {
  const [row] = await db
    .select({ revokedAt: tvTokens.revokedAt, expiresAt: tvTokens.expiresAt })
    .from(tvTokens)
    .where(eq(tvTokens.id, tokenId))
    .limit(1);
  if (!row || row.revokedAt) return false;
  return row.expiresAt.getTime() > now.getTime();
}

export async function cabutToken(
  id: string,
  revokedBy: string | null,
  now = new Date(),
): Promise<boolean> {
  const hasil = await db
    .update(tvTokens)
    .set({ revokedAt: now, revokedBy })
    .where(eq(tvTokens.id, id))
    .returning({ id: tvTokens.id });
  return hasil.length > 0;
}

/** Dicatat maksimum sekali per 5 menit — wallboard tidak boleh membanjiri DB. */
export async function catatPemakaian(
  tokenId: string,
  now = new Date(),
): Promise<void> {
  const [row] = await db
    .select({ lastUsedAt: tvTokens.lastUsedAt, useCount: tvTokens.useCount })
    .from(tvTokens)
    .where(eq(tvTokens.id, tokenId))
    .limit(1);
  if (!row) return;
  if (row.lastUsedAt && now.getTime() - row.lastUsedAt.getTime() < 5 * 60_000) {
    return;
  }
  await db
    .update(tvTokens)
    .set({ lastUsedAt: now, useCount: row.useCount + 1 })
    .where(eq(tvTokens.id, tokenId));
}

/** Daftar untuk layar admin — TIDAK PERNAH memuat token maupun hash-nya. */
export async function daftarToken() {
  const rows = await db.select().from(tvTokens);
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      tokenPrefix: r.tokenPrefix,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
      useCount: r.useCount,
      revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
