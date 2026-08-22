import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { db } from "@/db";
import { odpPorts, odps } from "@/db/schema";
import {
  KOLOM_URUT,
  UKURAN_HALAMAN,
  cariOdp,
  kolomSah,
  ukuranSah,
} from "@/server/odp-read";
import type { KolomUrut } from "@/server/odp-read";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/ftth/odps
 *
 * `usedPorts` DITURUNKAN dari tabel port, bukan disimpan sebagai kolom —
 * supaya tidak pernah ada dua angka yang berbeda tentang hal yang sama.
 *
 * Parameter (semuanya opsional):
 *
 *   q         cari di code dan name sekaligus
 *   siteId    saring satu situs
 *   oltId     saring satu OLT
 *   sort      code | name | capacity | usedPorts   (default code)
 *   dir       asc | desc                            (default asc)
 *   page      halaman, 1-basis
 *   pageSize  20 | 50 | 100
 *
 * **Tanpa `page` maupun `pageSize`, jawaban tetap seperti dulu**: seluruh ODP
 * sampai 2.000 baris. Disengaja supaya layar `/ftth` tidak diam-diam
 * kehilangan 560 dari 580 barisnya di antara deploy backend dan pembaruan
 * frontend. Begitu T-40 mendarat, mode itu tidak dipakai lagi.
 *
 * Pencariannya di SERVER, bukan di browser. Penyaringan di browser hanya
 * menyaring yang terkirim — begitu paginasi dipakai, hasil pencarian jadi
 * tidak lengkap tanpa ada yang tahu.
 */
export const GET = withRole([], async (request) => {
  const p = new URL(request.url).searchParams;

  const sortMentah = p.get("sort");
  if (sortMentah && !kolomSah(sortMentah)) {
    return NextResponse.json(
      { error: `sort harus salah satu dari: ${KOLOM_URUT.join(", ")}.` },
      { status: 400 },
    );
  }
  const dirMentah = p.get("dir");
  if (dirMentah && dirMentah !== "asc" && dirMentah !== "desc") {
    return NextResponse.json({ error: "dir harus asc atau desc." }, { status: 400 });
  }
  const pageSizeMentah = p.get("pageSize");
  if (pageSizeMentah !== null && !ukuranSah(Number(pageSizeMentah))) {
    // Ukuran bebas membuat satu permintaan bisa menarik seluruh tabel.
    return NextResponse.json(
      { error: `pageSize harus ${UKURAN_HALAMAN.join(", ")}.` },
      { status: 400 },
    );
  }
  const pageMentah = p.get("page");
  if (pageMentah !== null && !Number.isInteger(Number(pageMentah))) {
    return NextResponse.json({ error: "page harus bilangan bulat." }, { status: 400 });
  }

  const hasil = await cariOdp({
    q: p.get("q"),
    siteId: p.get("siteId"),
    oltId: p.get("oltId"),
    sort: (sortMentah as KolomUrut | null) ?? undefined,
    dir: (dirMentah as "asc" | "desc" | null) ?? undefined,
    page: pageMentah === null ? null : Number(pageMentah),
    pageSize: pageSizeMentah === null ? null : Number(pageSizeMentah),
  });

  return NextResponse.json(
    {
      odps: hasil.rows,
      total: hasil.total,
      page: hasil.page,
      pageSize: hasil.pageSize,
      halamanTerakhir: hasil.halamanTerakhir,
      terpotong: hasil.terpotong,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});

/** POST — membuat ODP sekaligus port-portnya sebanyak `capacity`. */
export const POST = withRole(["admin", "noc"], async (request) => {
  let body: { code?: string; name?: string; siteId?: string; oltId?: string; capacity?: number; latitude?: number; longitude?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body harus JSON yang valid." }, { status: 400 });
  }
  const code = body.code?.trim().toUpperCase();
  const name = body.name?.trim();
  if (!code || !name) {
    return NextResponse.json({ error: "code dan name wajib diisi." }, { status: 400 });
  }
  const capacity = body.capacity ?? 8;
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 256) {
    return NextResponse.json({ error: "capacity harus 1–256." }, { status: 400 });
  }

  try {
    const id = randomUUID();
    await db.insert(odps).values({
      id, code, name,
      siteId: body.siteId ?? null, oltId: body.oltId ?? null,
      latitude: body.latitude ?? null, longitude: body.longitude ?? null,
      capacity,
    });
    // Port dibuat sekaligus: ODP tanpa port tidak bisa dipetakan, dan membuat
    // port satu per satu lewat UI adalah pekerjaan yang tidak perlu ada.
    await db.insert(odpPorts).values(
      Array.from({ length: capacity }, (_, i) => ({
        id: randomUUID(), odpId: id, portNumber: i + 1, status: "kosong" as const,
      })),
    );
    return NextResponse.json({ id, code, name, capacity }, { status: 201 });
  } catch {
    return NextResponse.json({ error: `Kode ODP ${code} sudah dipakai.` }, { status: 409 });
  }
});
