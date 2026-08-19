// Probe keterjangkauan — portal ini mengukur sendiri, tidak menunggu LibreNMS.
//
// Kenapa ada: sampai Fase 8 seluruh keadaan perangkat datang dari LibreNMS.
// Itu berhenti berguna saat LibreNMS tidak punya perangkat terdaftar — portal
// jadi buta bukan karena rusak, melainkan karena sumbernya kosong. Probe ini
// memberi portal satu sumber yang tidak bergantung pada discovery LibreNMS.
//
// Aturan yang dipegang, disalin dari `crm/src/lib/probe.ts`:
//  - Probe BACA-SAJA terhadap perangkat: membuka koneksi TCP lalu menutupnya.
//    Tidak ada perintah yang dikirim, tidak ada konfigurasi yang disentuh.
//    Karena itu ia TIDAK melewati outward-guard: bertanya bukan bertindak,
//    sama seperti pembacaan LibreNMS.
//  - DOWN tidak langsung membangunkan orang. Alarm baru naik setelah gagal
//    berturut-turut mencapai `failThreshold`, dan ditutup otomatis saat pulih.
//  - Hasil tiap pemeriksaan bersifat append-only.
//
// Catatan metode, dan batasnya harus jujur: ICMP ping butuh raw socket (hak
// root) yang tidak dimiliki proses aplikasi, jadi keterjangkauan diukur lewat
// TCP connect. Konsekuensinya perangkat yang HIDUP tetapi portnya tertutup
// akan terbaca DOWN — karena itu portnya dapat disetel per sasaran, dan
// memilih port yang salah akan menghasilkan alarm palsu yang meyakinkan.

import net from "node:net";
import { randomUUID } from "node:crypto";
import { eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, networkAlarms, probeResults, probeTargets } from "@/db/schema";
import type { TaskDefinition } from "@/server/scheduler";

export interface ProbeOutcome {
  status: "UP" | "DOWN";
  latencyMs: number | null;
  error?: string;
}

export type Prober = (
  address: string,
  port: number,
  timeoutMs: number,
) => Promise<ProbeOutcome>;

/** Probe TCP nyata: buka koneksi, catat waktu, langsung tutup. */
export const tcpProbe: Prober = (address, port, timeoutMs) =>
  new Promise<ProbeOutcome>((resolve) => {
    const mulai = Date.now();
    const socket = new net.Socket();
    let selesai = false;

    const tutup = (outcome: ProbeOutcome) => {
      if (selesai) return;
      selesai = true;
      socket.destroy();
      resolve(outcome);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () =>
      tutup({ status: "UP", latencyMs: Date.now() - mulai }),
    );
    socket.once("timeout", () =>
      tutup({ status: "DOWN", latencyMs: null, error: `timeout setelah ${timeoutMs}ms` }),
    );
    socket.once("error", (err) =>
      tutup({ status: "DOWN", latencyMs: null, error: err.message }),
    );

    try {
      socket.connect(port, address);
    } catch (err) {
      tutup({
        status: "DOWN",
        latencyMs: null,
        error: err instanceof Error ? err.message : "gagal membuka koneksi",
      });
    }
  });

async function nomorAlarmBerikutnya(now: Date): Promise<string> {
  const awalan = `ALM-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(networkAlarms)
    .where(sql`${networkAlarms.alarmNumber} like ${`${awalan}%`}`);
  return `${awalan}-${String((row?.n ?? 0) + 1).padStart(4, "0")}`;
}

async function catatAudit(
  action: string,
  entityId: string,
  detail: Record<string, unknown>,
) {
  await db.insert(auditLogs).values({
    id: randomUUID(),
    actorUserId: null,
    actorLabel: "system:probe",
    action,
    entityType: "network_alarm",
    entityId,
    detail,
    createdAt: new Date(),
  });
}

export interface ProbeRunResult {
  targetId: string;
  status: "UP" | "DOWN";
  latencyMs: number | null;
  alarmRaised: boolean;
  alarmCleared: boolean;
}

/** Jalankan satu sasaran dan terapkan aturan alarmnya. */
export async function runProbe(
  targetId: string,
  opts: { prober?: Prober; now?: Date } = {},
): Promise<ProbeRunResult | null> {
  const [target] = await db
    .select()
    .from(probeTargets)
    .where(eq(probeTargets.id, targetId))
    .limit(1);
  if (!target) return null;

  const now = opts.now ?? new Date();
  const prober = opts.prober ?? tcpProbe;
  const outcome = await prober(target.address, target.port, target.timeoutMs);

  await db.insert(probeResults).values({
    id: randomUUID(),
    targetId: target.id,
    checkedAt: now,
    status: outcome.status,
    latencyMs: outcome.latencyMs,
    error: outcome.error ?? null,
  });

  const gagal = outcome.status === "DOWN" ? target.consecutiveFails + 1 : 0;
  let alarmRaised = false;
  let alarmCleared = false;
  let openAlarmId = target.openAlarmId;

  // Alarm dinaikkan TEPAT saat ambang terlampaui, bukan tiap kali gagal —
  // kalau tidak, satu perangkat mati menghasilkan daftar alarm yang panjangnya
  // sepanjang gangguannya, dan daftar seperti itu berhenti dibaca orang.
  if (outcome.status === "DOWN" && gagal >= target.failThreshold && !openAlarmId) {
    const id = randomUUID();
    await db.insert(networkAlarms).values({
      id,
      alarmNumber: await nomorAlarmBerikutnya(now),
      severity: target.severity,
      source: "PROBE",
      assetId: target.assetId,
      message: `${target.name} (${target.address}:${target.port}) tidak terjangkau — ${gagal}× gagal berturut-turut`,
      dedupKey: `probe:${target.id}`,
      occurredAt: now,
      lastSeenAt: now,
    });
    openAlarmId = id;
    alarmRaised = true;
    await catatAudit("alarm.auto_open", id, {
      target: target.name,
      address: target.address,
      consecutiveFails: gagal,
    });
  } else if (outcome.status === "DOWN" && openAlarmId) {
    // Sudah ada alarm terbuka — cukup perbarui hitungannya.
    await db
      .update(networkAlarms)
      .set({ count: sql`${networkAlarms.count} + 1`, lastSeenAt: now })
      .where(eq(networkAlarms.id, openAlarmId));
  }

  if (outcome.status === "UP" && openAlarmId) {
    await db
      .update(networkAlarms)
      .set({ clearedAt: now })
      .where(eq(networkAlarms.id, openAlarmId));
    await catatAudit("alarm.auto_clear", openAlarmId, { target: target.name });
    openAlarmId = null;
    alarmCleared = true;
  }

  await db
    .update(probeTargets)
    .set({
      consecutiveFails: gagal,
      lastStatus: outcome.status,
      lastLatencyMs: outcome.latencyMs,
      lastCheckedAt: now,
      openAlarmId,
    })
    .where(eq(probeTargets.id, target.id));

  return {
    targetId: target.id,
    status: outcome.status,
    latencyMs: outcome.latencyMs,
    alarmRaised,
    alarmCleared,
  };
}

/** Jalankan semua sasaran aktif yang jatuh tempo. */
export async function runDueProbes(
  opts: { prober?: Prober; now?: Date } = {},
): Promise<ProbeRunResult[]> {
  const now = opts.now ?? new Date();
  const rows = await db
    .select({
      id: probeTargets.id,
      intervalSec: probeTargets.intervalSec,
      lastCheckedAt: probeTargets.lastCheckedAt,
    })
    .from(probeTargets)
    .where(eq(probeTargets.isActive, true));

  const hasil: ProbeRunResult[] = [];
  for (const row of rows) {
    const terakhir = row.lastCheckedAt;
    // Sasaran yang belum pernah diperiksa selalu jatuh tempo.
    if (terakhir !== null && now.getTime() - terakhir.getTime() < row.intervalSec * 1000) {
      continue;
    }
    const r = await runProbe(row.id, { prober: opts.prober, now });
    if (r) hasil.push(r);
  }
  return hasil;
}

/** Buang hasil probe yang lebih tua dari `hari`. */
export async function pruneProbeResults(
  hari = 14,
  now: Date = new Date(),
): Promise<number> {
  const batas = new Date(now.getTime() - hari * 86_400_000);
  const dibuang = await db
    .delete(probeResults)
    .where(lt(probeResults.checkedAt, batas))
    .returning({ id: probeResults.id });
  return dibuang.length;
}

export async function openAlarmCount(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(networkAlarms)
    .where(isNull(networkAlarms.clearedAt));
  return row?.n ?? 0;
}

/**
 * Kedua tugas ini MEMBACA saja, jadi keduanya boleh menyala secara bawaan —
 * sesuai aturan pada `TaskDefinition.enabledByDefault`.
 */
export const PROBE_TASKS: TaskDefinition[] = [
  {
    code: "probe.run",
    name: "Probe keterjangkauan",
    description:
      "Memeriksa sasaran aktif lewat TCP connect, menaikkan alarm setelah gagal berturut-turut, dan menutupnya saat pulih.",
    defaultIntervalSec: 60,
    enabledByDefault: true,
    run: async () => {
      const hasil = await runDueProbes();
      const down = hasil.filter((r) => r.status === "DOWN").length;
      const naik = hasil.filter((r) => r.alarmRaised).length;
      const tutup = hasil.filter((r) => r.alarmCleared).length;
      return `${hasil.length} sasaran diperiksa · ${down} down · ${naik} alarm naik · ${tutup} alarm ditutup`;
    },
  },
  {
    code: "probe.prune",
    name: "Pangkas hasil probe lama",
    description: "Membuang hasil probe yang lebih tua dari 14 hari.",
    defaultIntervalSec: 86_400,
    enabledByDefault: true,
    run: async () => `${await pruneProbeResults()} baris dibuang`,
  },
];
