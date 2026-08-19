import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, oltDevices } from "@/db/schema";
import {
  OltCliError,
  PerintahDitolak,
  jalankanPerintahBaca,
  periksaPerintahBaca,
} from "@/server/olt-cli";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

/**
 * Konsol perangkat — endpoint paling berisiko di aplikasi ini, dan dijaga
 * seperti itu.
 *
 * Sebagian OLT tidak mendukung SNMP sama sekali, jadi satu-satunya cara
 * membacanya adalah masuk ke konsolnya. Daripada orang membuka telnet sendiri
 * dari laptopnya — tanpa jejak, tanpa batas perintah — portal menyediakannya
 * dengan tiga pagar yang tidak bisa dilewati:
 *
 * 1. **Perangkat dipilih dari DAFTAR, bukan dari alamat.** Pemanggil mengirim
 *    `oltId`, bukan host/port. Tanpa ini endpoint ini jadi mesin telnet umum
 *    yang bisa diarahkan ke mana saja di jaringan — termasuk ke tempat yang
 *    tidak ada urusannya dengan NOC.
 * 2. **Perintah disaring daftar putih kata pertama** (`periksaPerintahBaca`).
 *    Yang mengubah keadaan ditolak sebelum koneksi dibuka.
 * 3. **Setiap percobaan dicatat** — yang ditolak maupun yang dijalankan,
 *    lengkap dengan siapa dan perintah apa. Konsol tanpa jejak adalah konsol
 *    yang tidak bisa dipertanggungjawabkan.
 */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const percobaan = new Map<string, { n: number; mulai: number }>();

function terlaluSering(userId: string): boolean {
  const now = Date.now();
  const e = percobaan.get(userId);
  if (!e || now - e.mulai >= WINDOW_MS) {
    percobaan.set(userId, { n: 1, mulai: now });
    return false;
  }
  e.n += 1;
  return e.n > MAX_PER_WINDOW;
}

async function catat(
  userId: string,
  userName: string,
  oltId: string,
  perintah: string,
  hasil: "dijalankan" | "ditolak" | "gagal",
  detail?: string,
) {
  await db.insert(auditLogs).values({
    id: randomUUID(),
    actorUserId: userId,
    actorLabel: userName,
    action: `console.${hasil}`,
    entityType: "olt_device",
    entityId: oltId,
    detail: { perintah, ...(detail ? { detail } : {}) },
    createdAt: new Date(),
  });
}

export const POST = withRole(["admin", "noc"], async (request, user) => {
  let body: { oltId?: string; command?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body harus JSON yang valid." }, { status: 400 });
  }

  const oltId = body.oltId?.trim();
  const command = body.command?.trim();
  if (!oltId || !command) {
    return NextResponse.json({ error: "oltId dan command wajib diisi." }, { status: 400 });
  }

  if (terlaluSering(user.id)) {
    return NextResponse.json(
      { error: "Terlalu banyak perintah dalam satu menit." },
      { status: 429 },
    );
  }

  // Disaring SEBELUM perangkat dicari — perintah terlarang tidak perlu
  // menyentuh apa pun, bahkan tidak database.
  try {
    periksaPerintahBaca(command);
  } catch (e) {
    if (e instanceof PerintahDitolak) {
      await catat(user.id, user.name, oltId, command, "ditolak", e.message);
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    throw e;
  }

  const [olt] = await db.select().from(oltDevices).where(eq(oltDevices.id, oltId)).limit(1);
  if (!olt) {
    return NextResponse.json({ error: "OLT tidak ditemukan." }, { status: 404 });
  }
  if (!olt.telnetPort) {
    return NextResponse.json(
      { error: `${olt.name} belum punya telnet_port — konsol tidak bisa dibuka.` },
      { status: 409 },
    );
  }

  try {
    const output = await jalankanPerintahBaca(
      {
        host: olt.managementIp,
        port: olt.telnetPort,
        credentialRef: olt.credentialRef,
        timeoutMs: 25_000,
      },
      [command],
    );
    await catat(user.id, user.name, oltId, command, "dijalankan");
    return NextResponse.json(
      { olt: { id: olt.id, name: olt.name }, command, output },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const pesan = e instanceof Error ? e.message : String(e);
    await catat(user.id, user.name, oltId, command, "gagal", pesan);
    // Kredensial yang belum diisi adalah masalah konfigurasi, bukan galat
    // server — bedanya penting bagi yang membaca layar.
    const status = e instanceof OltCliError && /env var/i.test(pesan) ? 409 : 502;
    return NextResponse.json({ error: pesan }, { status });
  }
});
