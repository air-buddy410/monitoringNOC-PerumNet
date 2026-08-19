// Penjaga: dua nama slug berbeda pada jalur dinamis yang sama.
//
// Next MENOLAKNYA saat RUNTIME, bukan saat build. Pada 19 Agustus 2026
// `[alertId]` dan `[incidentId]` berdampingan di bawah `api/v1/incidents`;
// `npm run build` keluar dengan kode 0, dan portal baru jatuh dengan HTTP 500
// SETELAH di-deploy ke produksi. Uji ini memindahkan kegagalannya ke tempat
// yang murah — build hijau ternyata bukan bukti rutenya sah.

import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_DIR = path.resolve(__dirname, "..", "src", "app");

/** Kumpulkan nama slug per direktori induk. */
function kumpulkan(dir: string, keluar: Map<string, Set<string>>): void {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    const cocok = entry.match(/^\[(?:\.\.\.)?(.+?)\]$/);
    if (cocok) {
      const induk = path.relative(APP_DIR, dir) || ".";
      if (!keluar.has(induk)) keluar.set(induk, new Set());
      keluar.get(induk)!.add(cocok[1]);
    }
    kumpulkan(full, keluar);
  }
}

describe("guard: nama slug dinamis konsisten per jalur", () => {
  it("tidak ada direktori yang punya dua nama slug berbeda", () => {
    const peta = new Map<string, Set<string>>();
    kumpulkan(APP_DIR, peta);

    const bentrok = [...peta.entries()]
      .filter(([, nama]) => nama.size > 1)
      .map(([induk, nama]) => `${induk} → ${[...nama].sort().join(" vs ")}`);

    expect(bentrok).toEqual([]);
  });

  it("penyisirnya benar-benar melihat slug yang ada", () => {
    const peta = new Map<string, Set<string>>();
    kumpulkan(APP_DIR, peta);
    // Kalau penyisirnya salah jalan, uji di atas lulus karena tidak menemukan
    // apa pun — bukan karena tidak ada yang bentrok.
    expect([...peta.values()].reduce((n, s) => n + s.size, 0)).toBeGreaterThan(3);
  });
});
