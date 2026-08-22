import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { oltDevices } from "@/db/schema";
import { catatKonsol, terlaluSering } from "@/server/konsol-olt";
import { OltCliError, jalankanPerintahBaca } from "@/server/olt-cli";
import { perintahOnu, uraiOnuZte, type BarisOnu } from "@/server/olt-onu";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/devices/onu — daftar ONU satu OLT, sudah terurai.
 *
 * **POST, bukan GET, dan itu disengaja.** Endpoint ini MEMBUKA SESI TELNET ke
 * perangkat produksi. GET yang bisa dipicu prefetch peramban, crawler, atau
 * pratayang tautan akan membuka sesi tanpa ada yang memintanya. Pagarnya sama
 * persis dengan konsol — daftar perangkat, bukan alamat; batas laju bersama;
 * dan setiap percobaan dicatat.
 *
 * Ini BUKAN pengganti layar konsol. Konsol tetap menampilkan keluaran mentah
 * apa adanya supaya jawaban perangkat bisa ditelusuri; endpoint ini layar
 * kedua yang bisa disaring dan dihitung.
 */

export const UKURAN_HALAMAN = [20, 50, 100] as const;
const UKURAN_BAWAAN = 50;

interface Badan {
  oltId?: string;
  q?: string;
  status?: string;
  halaman?: number;
  ukuran?: number;
}

export const POST = withRole(["admin", "noc"], async (request, user) => {
  let body: Badan;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body harus JSON yang valid." }, { status: 400 });
  }

  const oltId = body.oltId?.trim();
  if (!oltId) {
    return NextResponse.json({ error: "oltId wajib diisi." }, { status: 400 });
  }

  if (terlaluSering(user.id)) {
    return NextResponse.json(
      { error: "Terlalu banyak perintah dalam satu menit." },
      { status: 429 },
    );
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

  const perintah = perintahOnu(olt.vendor);
  if (!perintah) {
    // Bukan 500 dan bukan daftar kosong: perangkatnya memang tidak punya
    // perintah daftar ONU. Daftar kosong akan terbaca sebagai "tidak ada ONU",
    // yang keliru — HSGQ-100-Kecicang jelas melayani pelanggan.
    return NextResponse.json(
      {
        error: `${olt.name} (${olt.vendor ?? "vendor tidak diketahui"}) tidak punya perintah daftar ONU di konsolnya.`,
        alasan:
          "HSGQ-G008 hanya menyediakan history, memory, startup-config, dan version — ditanyakan langsung ke perangkatnya. Daftar ONU-nya harus dibaca dari jalur lain.",
      },
      { status: 501 },
    );
  }

  let keluaran: string;
  try {
    keluaran = await jalankanPerintahBaca(
      {
        host: olt.managementIp,
        port: olt.telnetPort,
        credentialRef: olt.credentialRef,
        timeoutMs: 30_000,
      },
      [perintah],
    );
    await catatKonsol(user.id, user.name, oltId, perintah, "dijalankan");
  } catch (e) {
    const pesan = e instanceof Error ? e.message : String(e);
    await catatKonsol(user.id, user.name, oltId, perintah, "gagal", pesan);
    const status = e instanceof OltCliError && /env var/i.test(pesan) ? 409 : 502;
    return NextResponse.json({ error: pesan }, { status });
  }

  const { baris, ringkas, takTerurai } = uraiOnuZte(keluaran);

  const q = body.q?.trim().toLowerCase() ?? "";
  const status = body.status?.trim() ?? "";
  let saring: BarisOnu[] = baris;
  if (status === "tidak-sehat") saring = saring.filter((b) => !b.sehat);
  else if (status) saring = saring.filter((b) => b.phaseState === status);
  if (q) {
    saring = saring.filter(
      (b) => b.indeks.toLowerCase().includes(q) || b.ponPort.toLowerCase().includes(q),
    );
  }

  const ukuran = (UKURAN_HALAMAN as readonly number[]).includes(body.ukuran ?? 0)
    ? (body.ukuran as number)
    : UKURAN_BAWAAN;
  const halamanTerakhir = Math.max(1, Math.ceil(saring.length / ukuran));
  // Dijepit: daftar menyusut antar-permintaan, dan halaman 9 yang sah saat
  // diklik bisa sudah tidak ada saat sampai ke sini.
  const halaman = Math.min(Math.max(1, Math.trunc(body.halaman ?? 1)), halamanTerakhir);

  return NextResponse.json(
    {
      olt: { id: olt.id, name: olt.name, vendor: olt.vendor },
      perintah,
      // Ringkasan dihitung dari SELURUH ONU, bukan dari halaman yang tampil —
      // "3 LOS" harus tetap 3 walau halaman ini tidak memuat satu pun.
      ringkas,
      total: baris.length,
      totalTersaring: saring.length,
      halaman,
      ukuran,
      halamanTerakhir,
      baris: saring.slice((halaman - 1) * ukuran, halaman * ukuran),
      /**
       * Baris yang mengandung indeks ONU tapi gagal diurai. Hampir selalu
       * kosong; kalau terisi, layar WAJIB menampilkannya — daftar yang
       * diam-diam kehilangan baris terlihat persis seperti daftar yang utuh.
       */
      takTerurai,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
