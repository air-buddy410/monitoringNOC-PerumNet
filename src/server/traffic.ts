// Pengambil trafik dari router.
//
// Dua tugas berjadwal, dan pembagiannya penting untuk PRIVASI:
//
//   `traffic.discover` — menyapu `/rest/interface/ethernet` dan
//     `/rest/interface/vlan`. Dua resource itu secara bentuk tidak pernah
//     memuat interface pelanggan. Resource umum `/rest/interface` TIDAK
//     PERNAH disapu tanpa filter: ia mengembalikan 1.638 baris yang mayoritas
//     `pppoe-in` dinamis, dan NAMANYA ADALAH USERNAME PELANGGAN. Menyaringnya
//     setelah diterima berarti kita sudah menerimanya; menyaring di router
//     berarti data itu tidak pernah dikirim.
//
//   `traffic.poll` — menanyakan counter satu per satu berdasarkan NAMA yang
//     sudah diketahui. 93 byte per interface, jadi murah.
//
// Resource per-tipe hanya memberi NAMA, tidak memberi counter — diperiksa 20
// Agustus 2026. Karena itu dua langkah ini tidak bisa digabung.

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { trafficInterfaces, trafficSamples } from "@/db/schema";
import {
  ambilJson,
  headerAuth,
  routerConfig,
  sebabBelumSiap,
  type RouterConfig,
} from "@/server/routeros";
import type { TaskDefinition } from "@/server/scheduler";
import { hitungLaju, parseCounter, type Cuplikan } from "@/server/traffic-rate";

/** Berapa banyak interface yang boleh dinyalakan sendiri oleh penemuan. */
export const BATAS_AUTO_AKTIF = 24;
/** Umur sampel yang disimpan. */
export const RETENSI_HARI = 7;

interface BarisInterface {
  name?: string;
  running?: string;
  "rx-byte"?: string;
  "tx-byte"?: string;
}

export type PengambilRouter = (
  cfg: RouterConfig,
  path: string,
) => Promise<BarisInterface[]>;

const pengambilBawaan: PengambilRouter = async (cfg, path) => {
  const data = await ambilJson(`${cfg.baseUrl}${path}`, headerAuth(cfg), {
    timeoutMs: 10_000,
  });
  if (!Array.isArray(data)) throw new Error("Jawaban RouterOS bukan larik.");
  return data as BarisInterface[];
};

/** Query per NAMA — satu-satunya cara mendapat counter tanpa menyapu semuanya. */
function jalurCounter(nama: string): string {
  const q = new URLSearchParams({
    name: nama,
    ".proplist": "name,rx-byte,tx-byte,running",
  });
  return `/rest/interface?${q.toString()}`;
}

/**
 * Menemukan interface yang layak dipantau, tanpa pernah menyentuh nama
 * pelanggan.
 *
 * Kolom milik operator (`label`, `role`, `is_enabled`, `site_id`,
 * `capacity_bps`) tidak pernah ditimpa. Yang sengaja dimatikan orang harus
 * tetap mati sesudah deploy berikutnya.
 */
export async function discoverInterfaces(opts?: {
  fetcher?: PengambilRouter;
  now?: Date;
}): Promise<string> {
  const alasan = sebabBelumSiap();
  if (alasan) return `dilewati: ${alasan}`;
  const cfg = routerConfig();
  if (!cfg) return "dilewati: konfigurasi router belum lengkap";

  const ambil = opts?.fetcher ?? pengambilBawaan;
  const now = opts?.now ?? new Date();

  const kandidat: { nama: string; tipe: string }[] = [];
  for (const [path, tipe] of [
    ["/rest/interface/ethernet?.proplist=name", "ether"],
    ["/rest/interface/vlan?.proplist=name", "vlan"],
  ] as const) {
    for (const baris of await ambil(cfg, path)) {
      const nama = baris.name?.trim();
      if (nama) kandidat.push({ nama, tipe });
    }
  }

  const tersimpan = await db
    .select()
    .from(trafficInterfaces)
    .where(eq(trafficInterfaces.routerName, cfg.routerName));
  const perNama = new Map(tersimpan.map((r) => [r.ifName, r]));
  const aktifSekarang = tersimpan.filter((r) => r.isEnabled).length;

  let baru = 0;
  let dinyalakan = 0;
  let jatah = Math.max(0, BATAS_AUTO_AKTIF - aktifSekarang);

  for (const k of kandidat) {
    const ada = perNama.get(k.nama);
    if (ada) {
      await db
        .update(trafficInterfaces)
        .set({ ifType: k.tipe, missingSince: null, updatedAt: now })
        .where(eq(trafficInterfaces.id, ada.id));
      continue;
    }
    // Interface BARU: dinyalakan sendiri hanya bila sedang running dan jatah
    // masih ada. Tanpa ini layar hari pertama kosong dan orang menyimpulkan
    // fiturnya rusak; dengan jatah, 1.600 interface tidak pernah bisa
    // membanjiri penjadwal.
    let running = false;
    try {
      const [detail] = await ambil(cfg, jalurCounter(k.nama));
      running = detail?.running === "true";
    } catch {
      running = false;
    }
    const nyalakan = running && jatah > 0;
    if (nyalakan) jatah -= 1;
    await db.insert(trafficInterfaces).values({
      id: randomUUID(),
      routerName: cfg.routerName,
      ifName: k.nama,
      ifType: k.tipe,
      label: k.nama,
      isEnabled: nyalakan,
      createdAt: now,
      updatedAt: now,
    });
    baru += 1;
    if (nyalakan) dinyalakan += 1;
  }

  // Yang tidak lagi dijawab router ditandai, TIDAK dihapus. Menghapusnya
  // membuang riwayat trafiknya, dan interface bisa hilang cuma karena
  // diganti nama saat perawatan.
  const namaSekarang = new Set(kandidat.map((k) => k.nama));
  let hilang = 0;
  for (const r of tersimpan) {
    if (namaSekarang.has(r.ifName) || r.missingSince) continue;
    await db
      .update(trafficInterfaces)
      .set({ missingSince: now, updatedAt: now })
      .where(eq(trafficInterfaces.id, r.id));
    hilang += 1;
  }

  return (
    `${kandidat.length} kandidat · ${baru} baru · ${dinyalakan} dinyalakan` +
    (hilang ? ` · ${hilang} hilang` : "")
  );
}

export interface HasilPoll {
  diperiksa: number;
  tercatat: number;
  ditolak: Record<string, number>;
}

/** Cuplikan terakhir per interface — satu kueri, bukan satu per interface. */
async function cuplikanTerakhir(
  ids: string[],
): Promise<Map<string, Cuplikan>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([trafficSamples.interfaceId], {
      interfaceId: trafficSamples.interfaceId,
      sampledAt: trafficSamples.sampledAt,
      rxByte: trafficSamples.rxByte,
      txByte: trafficSamples.txByte,
    })
    .from(trafficSamples)
    .where(inArray(trafficSamples.interfaceId, ids))
    .orderBy(trafficSamples.interfaceId, desc(trafficSamples.sampledAt));
  return new Map(
    rows.map((r) => [
      r.interfaceId,
      { pada: r.sampledAt, rxByte: r.rxByte, txByte: r.txByte },
    ]),
  );
}

/**
 * Satu putaran pengambilan.
 *
 * Yang ditolak `hitungLaju` TIDAK menghasilkan baris — bukan baris bernilai
 * nol. Nol yang dikarang terbaca sebagai "trafik berhenti", dan itu gangguan
 * besar yang tidak pernah terjadi.
 */
export async function pollTraffic(opts?: {
  fetcher?: PengambilRouter;
  now?: Date;
}): Promise<HasilPoll & { pesan: string }> {
  const kosong: HasilPoll = { diperiksa: 0, tercatat: 0, ditolak: {} };
  const alasan = sebabBelumSiap();
  if (alasan) return { ...kosong, pesan: `dilewati: ${alasan}` };
  const cfg = routerConfig();
  if (!cfg) return { ...kosong, pesan: "dilewati: konfigurasi router belum lengkap" };

  const ambil = opts?.fetcher ?? pengambilBawaan;
  const now = opts?.now ?? new Date();

  const aktif = await db
    .select()
    .from(trafficInterfaces)
    .where(
      and(
        eq(trafficInterfaces.routerName, cfg.routerName),
        eq(trafficInterfaces.isEnabled, true),
      ),
    );
  if (aktif.length === 0) {
    // Diam saat belum dikonfigurasi tidak bisa dibedakan dari rusak.
    return { ...kosong, pesan: "dilewati: belum ada interface yang dipantau" };
  }

  const sebelumnya = await cuplikanTerakhir(aktif.map((r) => r.id));
  const hasil: HasilPoll = { diperiksa: 0, tercatat: 0, ditolak: {} };
  const barisBaru: (typeof trafficSamples.$inferInsert)[] = [];

  for (const iface of aktif) {
    hasil.diperiksa += 1;
    let detail: BarisInterface | undefined;
    try {
      [detail] = await ambil(cfg, jalurCounter(iface.ifName));
    } catch {
      hasil.ditolak.TIDAK_TERJAWAB = (hasil.ditolak.TIDAK_TERJAWAB ?? 0) + 1;
      continue;
    }
    if (!detail) {
      hasil.ditolak.HILANG = (hasil.ditolak.HILANG ?? 0) + 1;
      continue;
    }
    const rx = parseCounter(detail["rx-byte"]);
    const tx = parseCounter(detail["tx-byte"]);
    if (rx === null || tx === null) {
      hasil.ditolak.COUNTER_CACAT = (hasil.ditolak.COUNTER_CACAT ?? 0) + 1;
      continue;
    }
    const sekarang: Cuplikan = { pada: now, rxByte: rx, txByte: tx };
    const laju = hitungLaju(sebelumnya.get(iface.id) ?? null, sekarang, {
      kapasitasBps: iface.capacityBps,
    });
    if (!laju.ok) {
      hasil.ditolak[laju.sebab] = (hasil.ditolak[laju.sebab] ?? 0) + 1;
      // Cuplikan PERTAMA tetap disimpan sebagai acuan — tanpa itu, putaran
      // berikutnya juga tidak punya pembanding dan tidak ada laju yang pernah
      // lahir. Lajunya nol karena memang belum ada yang bisa dihitung.
      if (laju.sebab === "PERTAMA") {
        barisBaru.push({
          interfaceId: iface.id,
          sampledAt: now,
          rxBps: 0,
          txBps: 0,
          rxByte: rx,
          txByte: tx,
          dtMs: 0,
        });
      }
      continue;
    }
    barisBaru.push({
      interfaceId: iface.id,
      sampledAt: now,
      rxBps: laju.laju.rxBps,
      txBps: laju.laju.txBps,
      rxByte: rx,
      txByte: tx,
      dtMs: laju.laju.dtMs,
    });
    hasil.tercatat += 1;
  }

  if (barisBaru.length) {
    await db.insert(trafficSamples).values(barisBaru).onConflictDoNothing();
  }

  const tolak = Object.entries(hasil.ditolak)
    .map(([k, v]) => `${k}:${v}`)
    .join(" ");
  return {
    ...hasil,
    pesan:
      `${hasil.diperiksa} diperiksa · ${hasil.tercatat} tercatat` +
      (tolak ? ` · ditolak ${tolak}` : ""),
  };
}

export async function pruneTrafficSamples(
  hari = RETENSI_HARI,
  now = new Date(),
): Promise<number> {
  const batas = new Date(now.getTime() - hari * 86_400_000);
  const hasil = await db
    .delete(trafficSamples)
    .where(lt(trafficSamples.sampledAt, batas))
    .returning({ id: trafficSamples.interfaceId });
  return hasil.length;
}

export const TRAFFIC_TASKS: TaskDefinition[] = [
  {
    code: "traffic.poll",
    name: "Ambil trafik interface",
    description:
      "Menanyakan counter tiap interface yang dipantau, lalu menghitung laju dari selisihnya. Hanya membaca.",
    defaultIntervalSec: 60,
    enabledByDefault: true,
    run: async () => (await pollTraffic()).pesan,
  },
  {
    code: "traffic.discover",
    name: "Temukan interface router",
    description:
      "Menyapu ethernet & VLAN router untuk menemukan interface baru. TIDAK PERNAH menimpa label, peran, atau saklar yang disetel operator.",
    defaultIntervalSec: 3_600,
    enabledByDefault: true,
    run: () => discoverInterfaces(),
  },
  {
    code: "traffic.prune",
    name: "Pangkas sampel trafik lama",
    description: `Membuang sampel trafik yang lebih tua dari ${RETENSI_HARI} hari.`,
    defaultIntervalSec: 86_400,
    enabledByDefault: true,
    run: async () => `${await pruneTrafficSamples()} baris dibuang`,
  },
];
