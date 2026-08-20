import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    /**
     * Tujuh berkas tes membangun PGlite baru + menjalankan SELURUH migrasi di
     * `beforeEach`. Diukur 20 Agustus 2026: satu putaran build+migrasi ≈ 900 ms
     * (6 berkas migrasi, 24 KB SQL) — dan angka itu naik tiap kali skema
     * bertambah.
     *
     * Dengan batas bawaan 10 detik, berkas berisi 5 tes sudah memakai ~5 detik
     * hanya untuk persiapan; di bawah kontensi CPU (tes berjalan paralel) ia
     * melewati batas dan berkasnya GAGAL SELURUHNYA — bukan satu tes, tapi
     * satu berkas, dan sisanya tercatat "skipped". Gejalanya terlihat seperti
     * tes yang flaky, padahal ia murni soal waktu.
     *
     * 30 detik memberi ruang. Yang sebenarnya perlu dibereskan suatu saat:
     * pola `beforeEach` itu sendiri — bangun sekali per berkas, lalu reset
     * barisnya antar tes. Itu pekerjaan tujuh berkas, jadi tidak dikerjakan
     * bersamaan dengan perubahan skema.
     */
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
