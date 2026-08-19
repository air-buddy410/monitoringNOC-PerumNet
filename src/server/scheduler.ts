// Penjadwal pekerjaan berkala — BERJALAN DI LUAR REQUEST.
//
// Dijalankan oleh `scripts/worker.mjs` (npm run worker) sebagai proses
// terpisah, bukan di dalam permintaan HTTP. Permintaan HTTP berumur pendek dan
// bisa dibatalkan di tengah jalan; pekerjaan berkala tidak boleh bergantung
// pada ada tidaknya orang yang membuka halaman.
//
// Polanya disalin dari `crm/src/lib/scheduler.ts` yang sudah terbukti jalan,
// dengan satu pelajaran dari sana yang sengaja diperbaiki di sini — lihat
// catatan pada `enabledByDefault` di bawah.
//
// Sewa (lease): pekerjaan direbut dengan menulis `lockedAt`/`lockedBy`. Sewa
// yang kedaluwarsa boleh direbut worker lain, supaya worker yang mati mendadak
// tidak mengunci sebuah pekerjaan selamanya.

import { randomUUID } from "node:crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { scheduledTaskRuns, scheduledTasks } from "@/db/schema";

export interface TaskDefinition {
  code: string;
  name: string;
  description: string;
  defaultIntervalSec: number;
  /**
   * Keadaan awal saat kode ini dijumpai database yang BELUM punya barisnya.
   *
   * Pelajaran dari CRM: di sana `enabledByDefault: true` dipasang pada tugas
   * yang bertindak keluar, sehingga database baru menyalakan kembali lima
   * pekerjaan yang sengaja dimatikan. Di portal ini aturannya: **hanya tugas
   * yang MEMBACA yang boleh bernilai true.** Apa pun yang bertindak keluar
   * harus `false`, dan tetap melewati `outward-guard`.
   */
  enabledByDefault: boolean;
  run: () => Promise<string>;
}

export type TaskStatus = "SUCCESS" | "FAILED" | "SKIPPED";

export interface TaskOutcome {
  code: string;
  status: TaskStatus;
  detail?: string;
  error?: string;
  durationMs?: number;
}

/** Sewa dianggap kedaluwarsa setelah ini — worker lain boleh merebutnya. */
export const LEASE_TIMEOUT_MS = 5 * 60_000;

const registry = new Map<string, TaskDefinition>();

/** Daftarkan satu pekerjaan. Dipanggil dari modul yang memilikinya, supaya
 *  penjadwal tidak perlu tahu isi domainnya. */
export function registerTask(def: TaskDefinition): void {
  registry.set(def.code, def);
}

export function registeredTasks(): TaskDefinition[] {
  return [...registry.values()];
}

/** Hanya untuk pengujian. */
export function clearRegistry(): void {
  registry.clear();
}

/**
 * Samakan daftar pekerjaan di kode dengan yang ada di database.
 *
 * Pada baris yang SUDAH ada, hanya `name`/`description` yang diperbarui —
 * `isEnabled` dan `intervalSec` sengaja TIDAK disentuh. Keduanya keadaan
 * operator, dan deploy biasa tidak boleh menyalakan kembali apa yang sengaja
 * dimatikan orang.
 */
export async function syncTaskRegistry(): Promise<void> {
  for (const def of registry.values()) {
    const [ada] = await db
      .select({ id: scheduledTasks.id })
      .from(scheduledTasks)
      .where(eq(scheduledTasks.code, def.code))
      .limit(1);

    if (ada) {
      await db
        .update(scheduledTasks)
        .set({ name: def.name, description: def.description })
        .where(eq(scheduledTasks.id, ada.id));
      continue;
    }

    await db.insert(scheduledTasks).values({
      id: randomUUID(),
      code: def.code,
      name: def.name,
      description: def.description,
      intervalSec: def.defaultIntervalSec,
      isEnabled: def.enabledByDefault,
      createdAt: new Date(),
    });
  }
}

export interface DueRow {
  id: string;
  code: string;
  isEnabled: boolean;
  intervalSec: number;
  lastRunAt: Date | null;
  lockedAt: Date | null;
}

export function isDue(task: DueRow, now: Date): boolean {
  if (!task.isEnabled) return false;
  if (!task.lastRunAt) return true;
  return now.getTime() - task.lastRunAt.getTime() >= task.intervalSec * 1000;
}

export function isLeaseExpired(task: DueRow, now: Date): boolean {
  if (!task.lockedAt) return true;
  return now.getTime() - task.lockedAt.getTime() >= LEASE_TIMEOUT_MS;
}

/**
 * Rebut pekerjaan. Menang hanya bila sewanya masih kosong atau sudah
 * kedaluwarsa — pemeriksaannya ada di dalam WHERE, bukan di JavaScript, supaya
 * dua worker tidak bisa sama-sama merasa menang.
 */
export async function claimTask(
  taskId: string,
  workerId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const batas = new Date(now.getTime() - LEASE_TIMEOUT_MS);
  const hasil = await db
    .update(scheduledTasks)
    .set({ lockedAt: now, lockedBy: workerId })
    .where(
      and(
        eq(scheduledTasks.id, taskId),
        or(isNull(scheduledTasks.lockedAt), lt(scheduledTasks.lockedAt, batas)),
      ),
    )
    .returning({ id: scheduledTasks.id });
  return hasil.length > 0;
}

async function executeTask(
  row: DueRow,
  workerId: string,
): Promise<TaskOutcome> {
  const def = registry.get(row.code);
  if (!def) {
    return { code: row.code, status: "SKIPPED", error: "Tugas tidak terdaftar di kode." };
  }

  const runId = randomUUID();
  const mulai = Date.now();
  await db.insert(scheduledTaskRuns).values({
    id: runId,
    taskId: row.id,
    workerId,
    startedAt: new Date(),
    status: "RUNNING",
  });

  try {
    const detail = await def.run();
    const durationMs = Date.now() - mulai;
    await db
      .update(scheduledTaskRuns)
      .set({ finishedAt: new Date(), status: "SUCCESS", detail })
      .where(eq(scheduledTaskRuns.id, runId));
    await db
      .update(scheduledTasks)
      .set({
        lastRunAt: new Date(),
        lastStatus: "SUCCESS",
        lastError: null,
        lastDurationMs: durationMs,
        runCount: (await hitung(row.id)).runCount + 1,
        lockedAt: null,
        lockedBy: null,
      })
      .where(eq(scheduledTasks.id, row.id));
    return { code: row.code, status: "SUCCESS", detail, durationMs };
  } catch (error) {
    const pesan = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - mulai;
    await db
      .update(scheduledTaskRuns)
      .set({ finishedAt: new Date(), status: "FAILED", error: pesan })
      .where(eq(scheduledTaskRuns.id, runId));
    const c = await hitung(row.id);
    await db
      .update(scheduledTasks)
      .set({
        lastRunAt: new Date(),
        lastStatus: "FAILED",
        lastError: pesan,
        lastDurationMs: durationMs,
        runCount: c.runCount + 1,
        failCount: c.failCount + 1,
        lockedAt: null,
        lockedBy: null,
      })
      .where(eq(scheduledTasks.id, row.id));
    // Kegagalan satu tugas tidak boleh menjatuhkan worker — tugas lain masih
    // harus jalan, dan kegagalannya sudah tercatat sebagai keadaan yang
    // terlihat, bukan log yang tenggelam.
    return { code: row.code, status: "FAILED", error: pesan, durationMs };
  }
}

async function hitung(taskId: string) {
  const [row] = await db
    .select({ runCount: scheduledTasks.runCount, failCount: scheduledTasks.failCount })
    .from(scheduledTasks)
    .where(eq(scheduledTasks.id, taskId))
    .limit(1);
  return row ?? { runCount: 0, failCount: 0 };
}

/** Jalankan semua pekerjaan yang jatuh tempo. Dipanggil berulang oleh worker. */
export async function runDueTasks(
  workerId: string,
  now: Date = new Date(),
): Promise<TaskOutcome[]> {
  const rows = await db
    .select({
      id: scheduledTasks.id,
      code: scheduledTasks.code,
      isEnabled: scheduledTasks.isEnabled,
      intervalSec: scheduledTasks.intervalSec,
      lastRunAt: scheduledTasks.lastRunAt,
      lockedAt: scheduledTasks.lockedAt,
    })
    .from(scheduledTasks)
    .where(eq(scheduledTasks.isEnabled, true));

  const hasil: TaskOutcome[] = [];
  for (const row of rows) {
    if (!isDue(row, now)) continue;
    if (!isLeaseExpired(row, now)) continue;
    if (!(await claimTask(row.id, workerId, now))) continue;
    hasil.push(await executeTask(row, workerId));
  }
  return hasil;
}
