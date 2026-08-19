// Worker penjadwal — proses terpisah, di luar Next.js.
//
// Dijalankan PM2 sebagai proses sendiri (`npm run worker`). Sengaja BUKAN di
// dalam permintaan HTTP: permintaan berumur pendek dan bisa dibatalkan di
// tengah jalan, sementara pekerjaan berkala tidak boleh bergantung pada ada
// tidaknya orang yang sedang membuka halaman.
//
// Satu proses sudah cukup. Kalau kelak ada dua, sewa (lease) di scheduler yang
// mencegah keduanya menjalankan pekerjaan yang sama.
//
// Dijalankan lewat `tsx` — sama seperti worker CRM. Karena itu `tsx` ada di
// `dependencies`, BUKAN `devDependencies`: worker ini hidup di produksi, dan
// `npm ci` dengan NODE_ENV=production melewatkan devDependencies.

import { randomUUID } from "node:crypto";
import { PROBE_TASKS } from "@/server/probe";
import { registerTask, runDueTasks, syncTaskRegistry } from "@/server/scheduler";

const TICK_MS = Number(process.env.WORKER_TICK_MS ?? 15_000);
const workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;

let berhenti = false;
for (const sinyal of ["SIGTERM", "SIGINT"] as const) {
  process.on(sinyal, () => {
    console.log(`[worker ${workerId}] ${sinyal} diterima — berhenti setelah putaran ini`);
    berhenti = true;
  });
}

async function main() {
  for (const task of PROBE_TASKS) registerTask(task);
  await syncTaskRegistry();
  console.log(
    `[worker ${workerId}] siap · ${PROBE_TASKS.length} tugas terdaftar · tick ${TICK_MS}ms`,
  );

  while (!berhenti) {
    try {
      for (const h of await runDueTasks(workerId)) {
        console.log(
          `[worker] ${h.code} → ${h.status}` +
            (h.durationMs !== undefined ? ` (${h.durationMs}ms)` : "") +
            (h.detail ? ` — ${h.detail}` : "") +
            (h.error ? ` — ${h.error}` : ""),
        );
      }
    } catch (error) {
      // Worker tidak boleh mati karena satu putaran gagal — misalnya database
      // sedang restart. Dicatat, lalu dicoba lagi pada tick berikutnya.
      console.error(
        `[worker ${workerId}] putaran gagal:`,
        error instanceof Error ? error.message : error,
      );
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }

  console.log(`[worker ${workerId}] selesai`);
}

// Bukan top-level await: berkas ini ditransformasi ke CJS oleh tsx, dan di
// sana top-level await tidak didukung.
main().catch((error) => {
  console.error(`[worker ${workerId}] berhenti karena galat:`, error);
  process.exit(1);
});
