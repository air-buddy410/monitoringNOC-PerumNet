import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { pppoePollRuns } from "@/db/schema";
import { withRole } from "@/server/rbac";
import {
  KOLOM_URUT,
  UKURAN_HALAMAN,
  cariSesi,
  daftarRouter,
  ukuranSah,
} from "@/server/pppoe-read";
import type { KolomUrut } from "@/server/pppoe-read";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/pppoe/sessions
 *
 * Gambaran "siapa online menurut penarikan TERAKHIR". `lastRun` disertakan
 * supaya umur data terlihat: daftar sesi yang tidak diperbarui terlihat persis
 * sama dengan jaringan yang stabil, dan itu bahaya.
 *
 * Parameter (semuanya opsional):
 *
 *   q         cari di username, address, dan callerId sekaligus
 *   router    saring satu router
 *   sort      username | address | uptime | seenAt | router   (default username)
 *   dir       asc | desc                                       (default asc)
 *   page      halaman, 1-basis
 *   pageSize  20 | 50 | 100
 *
 * **Tanpa `page` maupun `pageSize`, jawaban tetap seperti dulu**: seluruh sesi
 * sampai 2.000 baris. Itu disengaja supaya layar lama tidak diam-diam
 * kehilangan 1.580 barisnya di antara deploy backend dan pembaruan frontend.
 * Begitu T-28 mendarat, mode itu tidak dipakai lagi.
 */
export const GET = withRole([], async (request) => {
  const p = new URL(request.url).searchParams;

  const sortMentah = p.get("sort");
  if (sortMentah && !KOLOM_URUT.includes(sortMentah as KolomUrut)) {
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
    // Ukuran bebas membuat satu permintaan bisa menarik seluruh tabel; tiga
    // pilihan sudah cukup untuk semua cara orang memakai layar ini.
    return NextResponse.json(
      { error: `pageSize harus ${UKURAN_HALAMAN.join(", ")}.` },
      { status: 400 },
    );
  }
  const pageMentah = p.get("page");
  if (pageMentah !== null && !Number.isInteger(Number(pageMentah))) {
    return NextResponse.json({ error: "page harus bilangan bulat." }, { status: 400 });
  }

  const [lastRun] = await db
    .select()
    .from(pppoePollRuns)
    .orderBy(desc(pppoePollRuns.startedAt))
    .limit(1);

  const hasil = await cariSesi({
    q: p.get("q"),
    router: p.get("router"),
    sort: (sortMentah as KolomUrut | null) ?? undefined,
    dir: (dirMentah as "asc" | "desc" | null) ?? undefined,
    page: pageMentah === null ? null : Number(pageMentah),
    pageSize: pageSizeMentah === null ? null : Number(pageSizeMentah),
  });

  return NextResponse.json(
    {
      lastRun: lastRun
        ? {
            status: lastRun.status,
            startedAt: lastRun.startedAt.toISOString(),
            finishedAt: lastRun.finishedAt?.toISOString() ?? null,
            sessionCount: lastRun.sessionCount,
            error: lastRun.error,
          }
        : null,
      sessions: hasil.rows.map((s) => ({
        username: s.username,
        address: s.address,
        callerId: s.callerId,
        uptimeSec: s.uptimeSec,
        routerName: s.routerName,
        seenAt: s.seenAt.toISOString(),
      })),
      total: hasil.total,
      page: hasil.page,
      pageSize: hasil.pageSize,
      halamanTerakhir: hasil.halamanTerakhir,
      terpotong: hasil.terpotong,
      routers: await daftarRouter(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
