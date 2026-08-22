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
import { loadEnvConfig } from "@next/env";

// WAJIB sebelum apa pun yang menyentuh database. Worker ini BUKAN Next.js,
// jadi `.env.production` tidak dimuat sendiri — dan tanpa DATABASE_URL,
// `src/db` diam-diam jatuh ke PGlite. Akibatnya worker menulis ke database
// yang BERBEDA dari aplikasinya: probe berjalan, alarm tercatat, dan tidak
// satu pun muncul di layar. Gagal seperti itu tidak menghasilkan galat apa pun.
// Dipakai loader milik Next supaya urutan berkasnya persis sama dengan aplikasi.
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

if (!process.env.DATABASE_URL?.trim()) {
  console.error(
    "[worker] DATABASE_URL kosong setelah memuat .env — worker akan memakai " +
      "PGlite, BUKAN database aplikasi. Berhenti; ini hampir pasti bukan yang dimaksud.",
  );
  process.exit(1);
}


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
  // Impor DINAMIS, sesudah env termuat: modul database membaca DATABASE_URL
  // saat dimuat, jadi impor statis di kepala berkas akan membacanya sebelum
  // `loadEnvConfig` sempat mengisinya.
  const { PROBE_TASKS } = await import("@/server/probe");
  const { PPPOE_TASKS } = await import("@/server/pppoe");
  const { TRAFFIC_TASKS } = await import("@/server/traffic");
  const { DEVICE_METRIC_TASKS } = await import("@/server/device-metrics-poll");
  const { registerTask, runDueTasks, syncTaskRegistry } = await import(
    "@/server/scheduler"
  );

  const TUGAS = [
    ...PROBE_TASKS,
    ...PPPOE_TASKS,
    ...TRAFFIC_TASKS,
    ...DEVICE_METRIC_TASKS,
  ];
  for (const task of TUGAS) registerTask(task);
  await syncTaskRegistry();
  console.log(
    `[worker ${workerId}] siap · ${TUGAS.length} tugas terdaftar · tick ${TICK_MS}ms`,
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
