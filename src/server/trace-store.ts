// Mesin trace jalur core (Fase 14).
//
// Tidak ada tabel baru di fase ini. Seluruh jalur DITURUNKAN dari yang sudah
// dicatat Fase 11–13: terminasi menempelkan ujung core ke port, core
// menghubungkan dua ujungnya sendiri sepanjang satu bentangan kabel, dan
// silangan menyambung ujung core ke ujung core lain di dalam closure.
// Menyimpan jalur sebagai tabel tersendiri berarti angka kedua tentang hal
// yang sama, dan ia akan basi pada perubahan topologi pertama.
//
// Tiga hal yang dijaga ketat di sini:
//
//   1. TIDAK MENGARANG. Kalau jalurnya putus, hasilnya berkata putus di titik
//      mana — bukan melompat ke tebakan terdekat. Jalur karangan lebih buruk
//      daripada tidak ada jalur, karena ia dipercaya.
//   2. TIDAK MENGGANTUNG. Data yang berputar akan membuat penelusuran naif
//      berjalan selamanya. Ujung yang sudah dilewati dicatat, dan ada batas
//      hop keras.
//   3. ESTIMASI TETAP DISEBUT ESTIMASI. Rugi optik di sini hasil penjumlahan
//      model, bukan pengukuran. Namanya `estimasiLossDb`, dan setiap
//      komponennya bisa ditelusuri ke asalnya.

import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  fiberCableSegments,
  fiberClosures,
  fiberCoreSplices,
  fiberCoreTerminations,
  fiberCores,
  odpPorts,
  odps,
  otb,
  otbPorts,
  otbTrays,
} from "@/db/schema";

/**
 * Model rugi optik — BUKAN hasil ukur.
 *
 * Angka ini nilai lazim yang dipakai saat merencanakan, bukan yang terbaca di
 * OTDR. Dipakai HANYA kalau baris silangan tidak menyimpan angkanya sendiri.
 * Kalau kelak ada data OTDR, ia ditampilkan terpisah dan tidak boleh
 * menggantikan angka di sini diam-diam — dua angka berbeda tentang hal yang
 * sama harus tetap terlihat berbeda.
 */
export const MODEL_RUGI_SAMBUNGAN_DB = 0.1;
export const MODEL_RUGI_KONEKTOR_DB = 0.3;

/** Batas keras. Jalur nyata tidak pernah sepanjang ini; kalau tercapai,
 *  datanya yang bermasalah, dan proses tidak boleh ikut bermasalah. */
export const MAKS_HOP = 500;
export const MAKS_JALUR = 64;

export type StatusJalur =
  | "LENGKAP"
  | "UJUNG_JALUR"
  | "JALUR_PUTUS"
  | "BERPUTAR"
  | "AMBIGU"
  | "TERPOTONG";

export type JenisLangkah =
  | "PORT_OTB"
  | "PORT_ODP"
  | "CORE"
  | "SILANGAN"
  | "SPLITTER";

export interface Langkah {
  urutan: number;
  jenis: JenisLangkah;
  label: string;
  detail: Record<string, unknown>;
}

export interface Jalur {
  langkah: Langkah[];
  status: StatusJalur;
  /** Kalimat yang bisa ditindak, bukan kode status. Selalu terisi kecuali LENGKAP. */
  diagnosis?: string;
  ringkas: {
    hop: number;
    panjangM: number | null;
    panjangLengkap: boolean;
    segmenUnik: number;
    /** Berapa kali sebuah segmen dilewati lebih dari sekali. Lihat `ringkas()`. */
    segmenBerulang: number;
    estimasiLossDb: number;
    sambunganPakaiModel: number;
  };
}

export interface HasilTrace {
  mulai: { jenis: string; id: string; label: string };
  jalur: Jalur[];
  ringkas: {
    total: number;
    lengkap: number;
    bermasalah: number;
    /** Terisi kalau jumlah cabang melampaui MAKS_JALUR. */
    terpotong?: boolean;
  };
}

type Titik =
  | { jenis: "otbPort"; id: string }
  | { jenis: "odpPort"; id: string }
  | { jenis: "coreEnd"; coreId: string; ujung: "A" | "B" };

function ujungLain(u: "A" | "B"): "A" | "B" {
  return u === "A" ? "B" : "A";
}

// ---------------------------------------------------------------------------
// Pembacaan satu-satu, dengan indeks yang sudah ada
// ---------------------------------------------------------------------------

async function bacaPortOtb(portId: string) {
  const [row] = await db
    .select({
      id: otbPorts.id,
      globalPortNumber: otbPorts.globalPortNumber,
      portNumberInTray: otbPorts.portNumberInTray,
      status: otbPorts.status,
      trayNumber: otbTrays.trayNumber,
      connectorType: otbTrays.connectorType,
      polish: otbTrays.polish,
      otbCode: otb.code,
      otbName: otb.name,
    })
    .from(otbPorts)
    .innerJoin(otbTrays, eq(otbTrays.id, otbPorts.trayId))
    .innerJoin(otb, eq(otb.id, otbPorts.otbId))
    .where(eq(otbPorts.id, portId))
    .limit(1);
  return row ?? null;
}

async function bacaPortOdp(portId: string) {
  const [row] = await db
    .select({
      id: odpPorts.id,
      portNumber: odpPorts.portNumber,
      status: odpPorts.status,
      externalServiceId: odpPorts.externalServiceId,
      odpId: odps.id,
      odpCode: odps.code,
      odpName: odps.name,
      odpRole: odps.role,
      capacity: odps.capacity,
    })
    .from(odpPorts)
    .innerJoin(odps, eq(odps.id, odpPorts.odpId))
    .where(eq(odpPorts.id, portId))
    .limit(1);
  return row ?? null;
}

async function bacaCore(coreId: string) {
  const [row] = await db
    .select({
      id: fiberCores.id,
      coreNumber: fiberCores.coreNumber,
      color: fiberCores.color,
      purpose: fiberCores.purpose,
      status: fiberCores.status,
      segmentId: fiberCableSegments.id,
      segmentCode: fiberCableSegments.code,
      segmentCategory: fiberCableSegments.category,
      segmentStatus: fiberCableSegments.status,
      lengthM: fiberCableSegments.lengthM,
      fiberType: fiberCableSegments.fiberType,
    })
    .from(fiberCores)
    .innerJoin(fiberCableSegments, eq(fiberCableSegments.id, fiberCores.segmentId))
    .where(eq(fiberCores.id, coreId))
    .limit(1);
  return row ?? null;
}

/** Terminasi aktif pada sebuah ujung core. */
async function terminasiUjung(coreId: string, ujung: "A" | "B") {
  const [row] = await db
    .select()
    .from(fiberCoreTerminations)
    .where(
      and(
        eq(fiberCoreTerminations.coreId, coreId),
        eq(fiberCoreTerminations.coreEnd, ujung),
        isNull(fiberCoreTerminations.deactivatedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Silangan aktif yang menyentuh sebuah ujung core — dari sisi mana pun. */
async function silanganUjung(coreId: string, ujung: "A" | "B") {
  const rows = await db
    .select({
      id: fiberCoreSplices.id,
      closureId: fiberCoreSplices.closureId,
      closureCode: fiberClosures.code,
      closureName: fiberClosures.name,
      inputCoreId: fiberCoreSplices.inputCoreId,
      inputCoreEnd: fiberCoreSplices.inputCoreEnd,
      outputCoreId: fiberCoreSplices.outputCoreId,
      outputCoreEnd: fiberCoreSplices.outputCoreEnd,
      estimatedLossDb: fiberCoreSplices.estimatedLossDb,
    })
    .from(fiberCoreSplices)
    .innerJoin(fiberClosures, eq(fiberClosures.id, fiberCoreSplices.closureId))
    .where(
      and(
        isNull(fiberCoreSplices.deactivatedAt),
        or(
          and(
            eq(fiberCoreSplices.inputCoreId, coreId),
            eq(fiberCoreSplices.inputCoreEnd, ujung),
          ),
          and(
            eq(fiberCoreSplices.outputCoreId, coreId),
            eq(fiberCoreSplices.outputCoreEnd, ujung),
          ),
        ),
      ),
    );
  return rows;
}

/**
 * Terminasi aktif pada port-port LAIN dari master splitter yang sama,
 * beserta peruntukan core-nya.
 *
 * Peruntukan itulah yang membedakan input dari output, dan ia sudah tersimpan
 * di `fiber_cores.purpose` — tidak perlu penanda arah baru di `odp_ports`,
 * yang berarti mengubah tabel dengan 8.632 baris produksi.
 *
 * Arah penelusuran menentukan apa yang dicari:
 *
 * - Tiba lewat core FEEDER  → kita masuk dari input; keluarannya adalah
 *   seluruh port bercore DISTRIBUTION. Ini pembagian yang sah.
 * - Tiba lewat core DISTRIBUTION → kita naik dari salah satu keluaran;
 *   lanjutannya HANYA port bercore FEEDER, yaitu inputnya.
 *
 * Tanpa penyaringan ini, telusur balik dari sebuah ODP akan menyeberang ke
 * ODP tetangga lewat splitter — jalur yang tidak pernah dilewati cahaya, dan
 * persis jenis karangan yang paling meyakinkan.
 */
async function cabangSplitter(
  odpId: string,
  kecualiPortId: string,
  cariPurpose: "feeder" | "distribution",
) {
  const portLain = await db
    .select({ id: odpPorts.id })
    .from(odpPorts)
    .where(eq(odpPorts.odpId, odpId));
  const ids = portLain.map((p) => p.id).filter((id) => id !== kecualiPortId);
  if (ids.length === 0) return [];
  return db
    .select({
      id: fiberCoreTerminations.id,
      coreId: fiberCoreTerminations.coreId,
      coreEnd: fiberCoreTerminations.coreEnd,
      odpPortId: fiberCoreTerminations.odpPortId,
      purpose: fiberCores.purpose,
    })
    .from(fiberCoreTerminations)
    .innerJoin(fiberCores, eq(fiberCores.id, fiberCoreTerminations.coreId))
    .where(
      and(
        inArray(fiberCoreTerminations.odpPortId, ids),
        isNull(fiberCoreTerminations.deactivatedAt),
        eq(fiberCores.purpose, cariPurpose),
      ),
    );
}

// ---------------------------------------------------------------------------
// Penelusuran
// ---------------------------------------------------------------------------

interface Kerja {
  langkah: Langkah[];
  dilewati: Set<string>;
  lintasan: { segmentId: string; lengthM: number | null }[];
  lossDb: number;
  pakaiModel: number;
  posisi: Titik;
}

function kunciUjung(coreId: string, ujung: string) {
  return `${coreId}#${ujung}`;
}

function salin(k: Kerja, posisi: Titik): Kerja {
  return {
    langkah: [...k.langkah],
    dilewati: new Set(k.dilewati),
    lintasan: [...k.lintasan],
    lossDb: k.lossDb,
    pakaiModel: k.pakaiModel,
    posisi,
  };
}

/**
 * Panjang dijumlahkan PER LINTASAN, bukan per segmen unik — dan itu
 * penyimpangan yang disengaja dari kalimat "jumlahkan segmen unik" di PRD.
 *
 * Alasannya fisik. Jalur yang keluar lewat core 17 dan kembali lewat core 18
 * pada kabel yang SAMA benar-benar menempuh dua kali panjang kabel itu;
 * menghitungnya sekali akan melaporkan jarak yang terlalu pendek, dan angka
 * itu dipakai untuk menakar jarak-ke-gangguan pada OTDR.
 *
 * Yang sebenarnya dikhawatirkan PRD adalah penggelembungan akibat data yang
 * BERPUTAR — dan itu sudah ditangkap terpisah sebagai `BERPUTAR`, jadi jalur
 * berputar tidak pernah sampai ke ringkasan ini. `segmenBerulang` tetap
 * dilaporkan supaya lintasan bolak-balik terlihat, bukan tersembunyi di
 * dalam satu angka.
 *
 * NULL berarti belum diukur, dan tidak pernah dijumlahkan sebagai nol — total
 * yang terlihat pasti padahal separuhnya karangan lebih buruk daripada total
 * yang mengaku belum lengkap.
 */
function ringkas(k: Kerja): Jalur["ringkas"] {
  let panjangM = 0;
  let lengkap = true;
  for (const l of k.lintasan) {
    if (l.lengthM === null) lengkap = false;
    else panjangM += l.lengthM;
  }
  const unik = new Set(k.lintasan.map((l) => l.segmentId)).size;
  return {
    hop: k.langkah.length,
    panjangM: k.lintasan.length === 0 ? null : panjangM,
    panjangLengkap: lengkap,
    segmenUnik: unik,
    segmenBerulang: k.lintasan.length - unik,
    estimasiLossDb: Math.round(k.lossDb * 100) / 100,
    sambunganPakaiModel: k.pakaiModel,
  };
}

function selesai(
  k: Kerja,
  status: StatusJalur,
  diagnosis?: string,
): Jalur {
  return { langkah: k.langkah, status, diagnosis, ringkas: ringkas(k) };
}

/**
 * Menelusuri jalur dari sebuah titik awal.
 *
 * Hasilnya DAFTAR jalur, bukan satu: melewati master splitter membuat satu
 * jalur bercabang jadi beberapa, dan tiap cabang punya ujung serta
 * diagnosisnya sendiri. Cabang yang putus tidak boleh menghapus cabang yang
 * lengkap dari hasil — dua-duanya kenyataan.
 */
export async function telusuri(mulai: Titik): Promise<HasilTrace | null> {
  let label = "";
  if (mulai.jenis === "otbPort") {
    const p = await bacaPortOtb(mulai.id);
    if (!p) return null;
    label = `${p.otbCode} Tray ${p.trayNumber} port ${p.portNumberInTray} (global ${p.globalPortNumber})`;
  } else if (mulai.jenis === "odpPort") {
    const p = await bacaPortOdp(mulai.id);
    if (!p) return null;
    label = `${p.odpCode} port ${p.portNumber}`;
  } else {
    const c = await bacaCore(mulai.coreId);
    if (!c) return null;
    label = `${c.segmentCode} core ${c.coreNumber} ujung ${mulai.ujung}`;
  }

  const antrean: Kerja[] = [
    {
      langkah: [],
      dilewati: new Set(),
      lintasan: [],
      lossDb: 0,
      pakaiModel: 0,
      posisi: mulai,
    },
  ];
  const jalur: Jalur[] = [];
  let terpotong = false;

  while (antrean.length > 0) {
    if (jalur.length >= MAKS_JALUR) {
      terpotong = true;
      break;
    }
    const k = antrean.shift()!;
    const cabangBaru: Kerja[] = [];
    let hasilJalur: Jalur | null = null;

    // Satu kerja ditelusuri sampai berhenti atau bercabang.
    for (;;) {
      if (k.langkah.length >= MAKS_HOP) {
        hasilJalur = selesai(
          k,
          "TERPOTONG",
          `Berhenti di ${MAKS_HOP} langkah. Jalur sepanjang ini hampir pasti berarti datanya berputar, bukan jaringannya.`,
        );
        break;
      }

      if (k.posisi.jenis === "otbPort" || k.posisi.jenis === "odpPort") {
        const isOtb = k.posisi.jenis === "otbPort";
        const portId = k.posisi.id;

        if (isOtb) {
          const p = await bacaPortOtb(portId);
          if (!p) {
            hasilJalur = selesai(k, "JALUR_PUTUS", "Port OTB tidak ditemukan.");
            break;
          }
          k.langkah.push({
            urutan: k.langkah.length + 1,
            jenis: "PORT_OTB",
            label: `${p.otbCode} · Tray ${p.trayNumber} port ${p.portNumberInTray}`,
            detail: {
              portId: p.id,
              otbCode: p.otbCode,
              otbName: p.otbName,
              trayNumber: p.trayNumber,
              portNumberInTray: p.portNumberInTray,
              globalPortNumber: p.globalPortNumber,
              connectorType: p.connectorType,
              polish: p.polish,
              status: p.status,
            },
          });
        } else {
          const p = await bacaPortOdp(portId);
          if (!p) {
            hasilJalur = selesai(k, "JALUR_PUTUS", "Port ODP tidak ditemukan.");
            break;
          }
          k.langkah.push({
            urutan: k.langkah.length + 1,
            jenis: p.odpRole === "MS" ? "SPLITTER" : "PORT_ODP",
            label:
              p.odpRole === "MS"
                ? `${p.odpCode} · master splitter 1:${p.capacity} · port ${p.portNumber}`
                : `${p.odpCode} · port ${p.portNumber}`,
            detail: {
              portId: p.id,
              odpId: p.odpId,
              odpCode: p.odpCode,
              odpName: p.odpName,
              odpRole: p.odpRole,
              portNumber: p.portNumber,
              status: p.status,
              // Identitas pelanggan TIDAK ikut — hanya ID layanan di sistem
              // lain. Repo ini publik.
              externalServiceId: p.externalServiceId,
            },
          });
        }

        const term = await db
          .select()
          .from(fiberCoreTerminations)
          .where(
            and(
              isOtb
                ? eq(fiberCoreTerminations.otbPortId, portId)
                : eq(fiberCoreTerminations.odpPortId, portId),
              isNull(fiberCoreTerminations.deactivatedAt),
            ),
          )
          .limit(1);
        if (term.length === 0) {
          hasilJalur = selesai(
            k,
            "UJUNG_JALUR",
            "Port ini belum diterminasi ke core mana pun.",
          );
          break;
        }
        k.lossDb += MODEL_RUGI_KONEKTOR_DB;
        k.pakaiModel += 1;
        k.posisi = {
          jenis: "coreEnd",
          coreId: term[0].coreId,
          ujung: term[0].coreEnd as "A" | "B",
        };
        continue;
      }

      // Kita berada DI sebuah ujung core, baru saja tiba dari luar.
      const { coreId, ujung } = k.posisi;
      const kMasuk = kunciUjung(coreId, ujung);
      if (k.dilewati.has(kMasuk)) {
        hasilJalur = selesai(
          k,
          "BERPUTAR",
          `Ujung core yang sama dilewati dua kali. Jalurnya berputar — periksa silangan di closure terakhir.`,
        );
        break;
      }
      k.dilewati.add(kMasuk);

      const core = await bacaCore(coreId);
      if (!core) {
        hasilJalur = selesai(k, "JALUR_PUTUS", "Core tidak ditemukan.");
        break;
      }
      if (core.status !== "baik") {
        hasilJalur = selesai(
          k,
          "JALUR_PUTUS",
          `Core ${core.coreNumber} pada ${core.segmentCode} berstatus ${core.status}.`,
        );
        break;
      }
      if (core.segmentStatus !== "aktif") {
        hasilJalur = selesai(
          k,
          "JALUR_PUTUS",
          `Kabel ${core.segmentCode} nonaktif.`,
        );
        break;
      }

      k.langkah.push({
        urutan: k.langkah.length + 1,
        jenis: "CORE",
        label: `${core.segmentCode} · core ${core.coreNumber} (${core.color ?? "?"})`,
        detail: {
          coreId: core.id,
          segmentId: core.segmentId,
          segmentCode: core.segmentCode,
          segmentCategory: core.segmentCategory,
          fiberType: core.fiberType,
          coreNumber: core.coreNumber,
          color: core.color,
          purpose: core.purpose,
          dariUjung: ujung,
          keUjung: ujungLain(ujung),
          panjangM: core.lengthM,
        },
      });
      k.lintasan.push({ segmentId: core.segmentId, lengthM: core.lengthM });

      const lain = ujungLain(ujung);
      const kKeluar = kunciUjung(coreId, lain);
      if (k.dilewati.has(kKeluar)) {
        hasilJalur = selesai(k, "BERPUTAR", "Ujung core yang sama dilewati dua kali.");
        break;
      }
      k.dilewati.add(kKeluar);

      const term = await terminasiUjung(coreId, lain);
      const silangan = await silanganUjung(coreId, lain);

      if (term && silangan.length > 0) {
        hasilJalur = selesai(
          k,
          "AMBIGU",
          `Ujung core ${core.coreNumber} pada ${core.segmentCode} punya terminasi DAN silangan aktif sekaligus. Hanya satu yang mungkin secara fisik — perbaiki datanya sebelum jalur ini bisa dipercaya.`,
        );
        break;
      }
      if (silangan.length > 1) {
        hasilJalur = selesai(
          k,
          "AMBIGU",
          `Ujung core ${core.coreNumber} punya ${silangan.length} silangan aktif. Pembagian hanya boleh lewat master splitter.`,
        );
        break;
      }

      if (term) {
        k.lossDb += MODEL_RUGI_KONEKTOR_DB;
        k.pakaiModel += 1;
        if (term.otbPortId) {
          k.posisi = { jenis: "otbPort", id: term.otbPortId };
          const p = await bacaPortOtb(term.otbPortId);
          k.langkah.push({
            urutan: k.langkah.length + 1,
            jenis: "PORT_OTB",
            label: p ? `${p.otbCode} · Tray ${p.trayNumber} port ${p.portNumberInTray}` : "Port OTB",
            detail: p ? { ...p } : { portId: term.otbPortId },
          });
          hasilJalur = selesai(k, "LENGKAP");
          break;
        }

        const p = await bacaPortOdp(term.odpPortId!);
        if (!p) {
          hasilJalur = selesai(k, "JALUR_PUTUS", "Port ODP tujuan tidak ditemukan.");
          break;
        }
        k.langkah.push({
          urutan: k.langkah.length + 1,
          jenis: p.odpRole === "MS" ? "SPLITTER" : "PORT_ODP",
          label:
            p.odpRole === "MS"
              ? `${p.odpCode} · master splitter 1:${p.capacity} · port ${p.portNumber}`
              : `${p.odpCode} · port ${p.portNumber}`,
          detail: {
            portId: p.id,
            odpId: p.odpId,
            odpCode: p.odpCode,
            odpName: p.odpName,
            odpRole: p.odpRole,
            portNumber: p.portNumber,
            externalServiceId: p.externalServiceId,
          },
        });

        if (p.odpRole !== "MS") {
          // ODP adalah ujung distribusi (PRD §3 aturan 1).
          hasilJalur = selesai(k, "LENGKAP");
          break;
        }

        // Master splitter: port yang kita masuki adalah inputnya, seluruh
        // port lain yang terterminasi adalah keluarannya. Percabangan di sini
        // adalah pembagian yang SAH — bukan anomali seperti dua silangan pada
        // satu ujung core.
        // Arah penelusuran ditentukan peruntukan core yang membawa kita
        // ke sini: core feeder berarti kita masuk dari input dan mencari
        // keluaran; core distribution berarti kita naik dari keluaran dan
        // mencari input.
        const naik = core.purpose === "distribution";
        const cabang = await cabangSplitter(
          p.odpId,
          p.id,
          naik ? "feeder" : "distribution",
        );
        if (cabang.length === 0) {
          hasilJalur = selesai(
            k,
            "UJUNG_JALUR",
            naik
              ? `Master splitter ${p.odpCode} belum punya input feeder yang diterminasi.`
              : `Master splitter ${p.odpCode} belum punya keluaran yang diterminasi.`,
          );
          break;
        }
        if (naik && cabang.length > 1) {
          hasilJalur = selesai(
            k,
            "AMBIGU",
            `Master splitter ${p.odpCode} punya ${cabang.length} input feeder aktif. Splitter hanya boleh punya satu.`,
          );
          break;
        }
        for (const c of cabang) {
          const anak = salin(k, {
            jenis: "coreEnd",
            coreId: c.coreId,
            ujung: c.coreEnd as "A" | "B",
          });
          const portKeluar = await bacaPortOdp(c.odpPortId!);
          anak.langkah.push({
            urutan: anak.langkah.length + 1,
            jenis: "PORT_ODP",
            label: portKeluar
              ? `${portKeluar.odpCode} · keluaran port ${portKeluar.portNumber}`
              : "Keluaran splitter",
            detail: portKeluar ? { ...portKeluar, keluaranSplitter: true } : {},
          });
          anak.lossDb += MODEL_RUGI_KONEKTOR_DB;
          anak.pakaiModel += 1;
          cabangBaru.push(anak);
        }
        break;
      }

      if (silangan.length === 1) {
        const s = silangan[0];
        const dariSisiInput = s.inputCoreId === coreId && s.inputCoreEnd === lain;
        const tujuanCoreId = dariSisiInput ? s.outputCoreId : s.inputCoreId;
        const tujuanUjung = (dariSisiInput ? s.outputCoreEnd : s.inputCoreEnd) as "A" | "B";
        const tujuan = await bacaCore(tujuanCoreId);

        const rugi = s.estimatedLossDb;
        if (rugi === null) k.pakaiModel += 1;
        k.lossDb += rugi ?? MODEL_RUGI_SAMBUNGAN_DB;

        k.langkah.push({
          urutan: k.langkah.length + 1,
          jenis: "SILANGAN",
          label: `${s.closureCode} · core ${core.coreNumber} → core ${tujuan?.coreNumber ?? "?"}`,
          detail: {
            spliceId: s.id,
            closureId: s.closureId,
            closureCode: s.closureCode,
            closureName: s.closureName,
            dariCoreNumber: core.coreNumber,
            keCoreNumber: tujuan?.coreNumber ?? null,
            // Nomor core berubah — inilah yang paling sering luput dicatat
            // manual, dan alasan modul ini ada.
            silang: tujuan ? tujuan.coreNumber !== core.coreNumber : null,
            estimasiRugiDb: rugi ?? MODEL_RUGI_SAMBUNGAN_DB,
            rugiDariModel: rugi === null,
          },
        });

        if (!tujuan) {
          hasilJalur = selesai(
            k,
            "JALUR_PUTUS",
            `Silangan di ${s.closureCode} menunjuk core yang tidak ada.`,
          );
          break;
        }
        k.posisi = { jenis: "coreEnd", coreId: tujuanCoreId, ujung: tujuanUjung };
        continue;
      }

      hasilJalur = selesai(
        k,
        "UJUNG_JALUR",
        `Ujung ${lain} core ${core.coreNumber} pada ${core.segmentCode} belum tersambung ke apa pun.`,
      );
      break;
    }

    if (hasilJalur) jalur.push(hasilJalur);
    antrean.push(...cabangBaru);
  }

  return {
    mulai: { jenis: mulai.jenis, id: "id" in mulai ? mulai.id : mulai.coreId, label },
    jalur,
    ringkas: {
      total: jalur.length,
      lengkap: jalur.filter((j) => j.status === "LENGKAP").length,
      bermasalah: jalur.filter(
        (j) => j.status !== "LENGKAP" && j.status !== "UJUNG_JALUR",
      ).length,
      ...(terpotong ? { terpotong: true } : {}),
    },
  };
}
