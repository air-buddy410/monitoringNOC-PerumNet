import { NextResponse } from "next/server";
import { readBackupFreshness } from "@/server/backup-freshness";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

/**
 * GET /api/backup-freshness
 *
 * Kesegaran cadangan seluruh aplikasi PerumNet, dibaca dari berkasnya langsung.
 *
 * Ada karena cadangan bisa berhenti diam-diam dan tidak ada yang membaca log
 * cron. Sinyalnya ditaruh di layar yang memang sudah dibuka orang tiap hari,
 * bukan dikirim — pemberitahuan butuh jalan keluar, dan 19 Agustus 2026
 * membuktikan jalan keluar bisa hilang justru saat kabar paling dibutuhkan.
 *
 * Cukup login, peran apa pun. Tidak memuat isi cadangan, hanya nama aplikasi,
 * waktu, dan ukuran.
 */
export const GET = withRole([], async () => {
  const apps = await readBackupFreshness();
  const bermasalah = apps.filter((a) => a.health !== "ok");

  return NextResponse.json(
    {
      /** true bila ADA yang perlu dilihat — satu boolean untuk penanda di shell. */
      needsAttention: bermasalah.length > 0,
      checkedAt: new Date().toISOString(),
      apps,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
