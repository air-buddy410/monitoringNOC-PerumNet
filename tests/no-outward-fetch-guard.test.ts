// Penjaga mode baca-saja: menahan jalur KELUAR baru yang ditambahkan diam-diam.
//
// Bentuknya meniru tests/no-prtg-guard.test.ts — menyisir sumber, lalu menolak
// apa pun di luar allowlist. Yang dijaga di sini bukan istilah, melainkan
// kemampuan menghubungi dunia luar dari sisi server.
//
// Lingkup sengaja dibatasi pada src/server/** dan src/app/api/** — src/lib/api
// dan src/components memanggil API aplikasi ini sendiri (same-origin) dan itu
// wilayah frontend; memasukkannya hanya akan membuat berkas Luna menabrak
// penjaga ini tanpa alasan.
//
// BATAS YANG HARUS DIAKUI: ini grep, bukan sandbox. Ia tidak melihat panggilan
// lewat dependensi npm, `globalThis["fe"+"tch"]`, atau Server Action di luar
// src/app/api. Jaminan yang sesungguhnya adalah aturan firewall keluar di VPS.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = path.resolve(__dirname, "..", "src");
const SCAN_DIRS = [path.join("server"), path.join("app", "api")];

/**
 * Berkas yang boleh menghubungi jaringan secara langsung, beserta alasannya.
 * Menambah baris di sini adalah keputusan sadar yang terlihat saat review.
 */
const NETWORK_ALLOWLIST: Record<string, string> = {
  [path.join("server", "outward-guard.ts")]:
    "pembungkus itu sendiri — satu-satunya pintu keluar",
  [path.join("server", "librenms", "client.ts")]:
    "hanya GET ke LibreNMS; tokennya read di sisi LibreNMS",
  [path.join("server", "mail-auth.ts")]:
    "probe TLS ke IMAP 993 untuk memeriksa password — bertanya, bukan bertindak. " +
    "JANGAN diblokir: memblokirnya mengunci semua orang dari portal saat AUTH_PROVIDER=MAILSERVER",
  [path.join("server", "olt-cli.ts")]:
    "telnet BACA-SAJA ke konsol OLT yang tidak mendukung SNMP. Perintahnya disaring " +
    "daftar putih kata pertama sebelum menyentuh soket — lihat tests/olt-cli-baca-saja.test.ts. " +
    "Bukan aksi keluar: ia membaca keadaan perangkat, tidak mengubahnya",
  [path.join("server", "pppoe.ts")]:
    "GET /rest/ppp/active ke router — hanya MEMBACA daftar sesi, tidak mengubah " +
    "satu pun konfigurasi router. Sekategori dengan pembacaan LibreNMS",
  [path.join("server", "probe.ts")]:
    "membuka koneksi TCP ke perangkat lalu menutupnya — tidak mengirim satu perintah pun. " +
    "Kategorinya sama dengan pembacaan LibreNMS: bertanya, bukan bertindak. " +
    "Memblokirnya membuat portal buta, yang justru kebalikan dari tujuannya",
};

/** Berkas yang wajib menempuh outwardFetch(), bukan fetch() telanjang. */
const MUST_USE_WRAPPER = [
  path.join("server", "crm-webhook.ts"),
  path.join("server", "notifier.ts"),
];

const NETWORK_PATTERNS: Array<[string, RegExp]> = [
  ["fetch(", /\bfetch\s*\(/],
  ["http.request(", /\bhttps?\.request\s*\(/],
  ["node:net/tls/http", /from\s+["']node:(net|tls|http|https|dgram)["']/],
  ["axios", /\baxios\b/],
  ["undici", /\bundici\b/],
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

function scannedFiles(): string[] {
  const out: string[] = [];
  for (const sub of SCAN_DIRS) {
    const full = path.join(SRC_DIR, sub);
    try {
      if (statSync(full).isDirectory()) out.push(...walk(full));
    } catch {
      // direktori belum ada — bukan kegagalan penjaga
    }
  }
  return out;
}

describe("guard: aksi keluar hanya lewat outward-guard", () => {
  it("tidak ada panggilan jaringan langsung di luar allowlist", () => {
    const offenders: string[] = [];
    for (const file of scannedFiles()) {
      const relative = path.relative(SRC_DIR, file);
      if (relative in NETWORK_ALLOWLIST) continue;
      // Pemanggil yang benar memakai outwardFetch(); buang dulu supaya tidak
      // terhitung sebagai fetch( telanjang.
      const content = readFileSync(file, "utf8").replaceAll("outwardFetch(", "");
      for (const [label, pattern] of NETWORK_PATTERNS) {
        if (pattern.test(content)) offenders.push(`${relative} → ${label}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("crm-webhook & notifier menempuh pembungkus, bukan fetch telanjang", () => {
    for (const relative of MUST_USE_WRAPPER) {
      const content = readFileSync(path.join(SRC_DIR, relative), "utf8");
      // Positif: pembungkusnya benar-benar dipakai (menghapus call site juga gagal).
      expect(content, `${relative} harus memakai outwardFetch()`).toContain(
        "outwardFetch(",
      );
      // Negatif: tidak ada fetch( yang tersisa setelah pembungkus dibuang.
      const withoutWrapper = content.replaceAll("outwardFetch(", "");
      expect(
        /\bfetch\s*\(/.test(withoutWrapper),
        `${relative} masih memanggil fetch() langsung`,
      ).toBe(false);
    }
  });

  it("daftar aksi keluar dipatok — menambah anggota harus disengaja", () => {
    const content = readFileSync(
      path.join(SRC_DIR, "server", "outward-guard.ts"),
      "utf8",
    );
    expect(content).toContain(
      'export type OutwardAction = "crm-webhook" | "telegram" | "whatsapp";',
    );
  });
});
