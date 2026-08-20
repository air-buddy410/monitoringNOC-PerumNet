import { NextResponse } from "next/server";
import { getLatestDevices } from "@/server/device-store";
import { withRole } from "@/server/rbac";
import type { DeviceStatus } from "@/types/device";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/summary
 * Ringkasan kesehatan jaringan untuk Big Numbers dasbor NOC.
 *
 * Sampai 20 Agustus 2026 rute ini TIDAK dijaga sama sekali: `src/proxy.ts`
 * sengaja mengecualikan `/api`, jadi ia menjawab jumlah perangkat online dan
 * offline kepada siapa pun di internet. Tidak ada galat, tidak ada jejak —
 * hanya 200. Lihat tests/no-unguarded-route-guard.test.ts.
 */
export const GET = withRole([], async () => {
  const snapshot = await getLatestDevices();

  const counts = snapshot.devices.reduce(
    (acc, device) => {
      acc[device.status] += 1;
      return acc;
    },
    { online: 0, warning: 0, offline: 0 } as Record<DeviceStatus, number>,
  );

  return NextResponse.json(
    {
      total: snapshot.devices.length,
      online: counts.online,
      warning: counts.warning,
      offline: counts.offline,
      updatedAt: snapshot.updatedAt,
    },
    {
      headers: {
        // `private`, bukan `public`: respons ini kini terikat sesi, dan cache
        // bersama yang menyimpannya akan menyajikannya ke orang lain.
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    },
  );
});
