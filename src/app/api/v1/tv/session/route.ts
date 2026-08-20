import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import {
  NAMA_COOKIE,
  UMUR_COOKIE_DETIK,
  buatNilaiCookie,
  verifikasiToken,
} from "@/server/tv-token";

export const dynamic = "force-dynamic";

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const percobaan = new Map<string, { n: number; mulai: number }>();

/**
 * Peredam penebakan. Diakui batasnya: `Map` per proses, dan get-lalu-set
 * punya balapan. Untuk memperlambat penebakan rahasia 256 bit itu lebih dari
 * cukup — menyebutnya "rate limit yang ketat" akan jadi kebohongan.
 */
function terlaluSering(ip: string): boolean {
  const now = Date.now();
  const e = percobaan.get(ip);
  if (!e || now - e.mulai >= WINDOW_MS) {
    percobaan.set(ip, { n: 1, mulai: now });
    return false;
  }
  e.n += 1;
  return e.n > MAX_PER_WINDOW;
}

/**
 * POST /api/v1/tv/session
 *
 * Menukar token layar TV dengan cookie HttpOnly, SEKALI. Token dikirim di
 * BODY — bukan query — supaya ia tidak pernah masuk access log, log Next,
 * maupun header `Referer` ke pihak ketiga. Layar TV mengambilnya dari FRAGMEN
 * URL (`/tv#token=…`), yang memang tidak pernah dikirim ke server.
 *
 * Sesudah ini halaman membersihkan URL-nya sendiri, jadi token tidak lagi
 * terpampang di address bar TV yang siapa pun bisa lihat.
 */
export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (terlaluSering(ip)) {
    return NextResponse.json(
      { error: "Terlalu banyak percobaan." },
      { status: 429 },
    );
  }

  let body: { token?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body harus JSON yang valid." }, { status: 400 });
  }
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) {
    return NextResponse.json({ error: "token wajib diisi." }, { status: 400 });
  }

  const hasil = await verifikasiToken(token);
  if (!hasil.ok) {
    // Sengaja kabur: tidak dibedakan antara salah, dicabut, dan kedaluwarsa.
    return NextResponse.json(
      { error: "Tautan layar TV tidak berlaku." },
      { status: 401 },
    );
  }

  // Umur cookie tidak boleh melampaui masa berlaku tokennya.
  const sisaDetik = Math.floor((hasil.expiresAt.getTime() - Date.now()) / 1000);
  const umur = Math.max(60, Math.min(UMUR_COOKIE_DETIK, sisaDetik));
  const exp = Math.floor(Date.now() / 1000) + umur;

  try {
    await db.insert(auditLogs).values({
      id: randomUUID(),
      actorUserId: null,
      actorLabel: `tv:${hasil.name}`,
      action: "tv.session.dibuka",
      entityType: "tv_token",
      entityId: hasil.id,
      detail: { ip },
      createdAt: new Date(),
    });
  } catch {
    /* audit gagal tidak boleh mengunci layar */
  }

  const res = NextResponse.json({ ok: true, name: hasil.name });
  res.cookies.set({
    name: NAMA_COOKIE,
    value: buatNilaiCookie(hasil.id, exp),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: umur,
  });
  return res;
}
