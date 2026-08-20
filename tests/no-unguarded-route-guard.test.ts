// Tidak boleh ada rute API tanpa penjaga.
//
// `src/proxy.ts` sengaja MENGECUALIKAN `/api` dari pemeriksaan sesi (matcher
// baris 47) — jadi satu-satunya yang menjaga sebuah endpoint adalah apa yang
// ditulis di dalam berkasnya sendiri. Rute yang lupa `withRole` tidak
// menghasilkan galat, tidak muncul di log, dan tetap menjawab 200 kepada
// siapa pun di internet. `noc.perumnet.id` terbuka di internet.
//
// Ditemukan 20 Agustus 2026: `/api/dashboard/summary`, `/api/reports/traffic`,
// dan `/api/reports/sla` menjawab tanpa sesi sama sekali.
//
// Daftar putih di bawah memuat ALASAN tiap rute, bukan cuma pathnya. Rute
// publik tanpa alasan tertulis adalah rute yang lupa dijaga.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const API_DIR = path.resolve(__dirname, "..", "src", "app", "api");

/** Rute yang memang publik — masing-masing dengan penjaganya sendiri. */
const BOLEH_PUBLIK: Record<string, string> = {
  "auth/[...all]": "Better Auth sendiri; login memang harus bisa dipanggil tanpa sesi.",
  "auth-mode":
    "Halaman login membutuhkannya SEBELUM ada sesi. Isinya hanya menyebut cara login diperiksa, bukan siapa saja yang punya akun.",
  "notifications/channels/verify":
    "Dijaga header x-bot-token (NOTIFICATION_BOT_SECRET, wajib) + rate limit per IP.",
  "v1/customer/services/[serviceId]/status":
    "Portal pelanggan: dijaga token HMAC dari CUSTOMER_PORTAL_SECRET.",
  "v1/tv/session":
    "Penukaran token layar TV jadi cookie. Tidak bisa memakai withRole — layar wallboard tidak punya sesi. Dijaga token SHA-256 + rate limit per IP.",
  "v1/tv/snapshot":
    "Satu-satunya endpoint yang menerima cookie TV. Barisnya diperiksa tiap permintaan sehingga pencabutan berlaku seketika; muatannya dipangkas tanpa IP/hostname/vendor.",
  "v1/integrations/librenms/alerts":
    "Webhook masuk: dijaga header x-webhook-token (LIBRENMS_WEBHOOK_SECRET) + rate limit per IP.",
};

function semuaRute(dir: string, prefix = ""): string[] {
  const hasil: string[] = [];
  for (const entri of readdirSync(dir)) {
    const penuh = path.join(dir, entri);
    if (statSync(penuh).isDirectory()) {
      hasil.push(...semuaRute(penuh, prefix ? `${prefix}/${entri}` : entri));
    } else if (entri === "route.ts") {
      hasil.push(prefix);
    }
  }
  return hasil;
}

describe("setiap rute API punya penjaga", () => {
  const rute = semuaRute(API_DIR).sort();

  it("menemukan rute untuk diperiksa", () => {
    expect(rute.length).toBeGreaterThan(20);
  });

  it("tidak ada rute tanpa withRole di luar daftar putih", () => {
    const bocor = rute.filter((r) => {
      if (r in BOLEH_PUBLIK) return false;
      const isi = readFileSync(path.join(API_DIR, r, "route.ts"), "utf8");
      return !isi.includes("withRole");
    });
    expect(bocor).toEqual([]);
  });

  it("tiap rute di daftar putih benar-benar ada — daftar tidak boleh basi", () => {
    // Daftar putih yang menyebut rute yang sudah dihapus akan diam-diam
    // memaafkan rute BARU yang kebetulan bernama sama.
    for (const r of Object.keys(BOLEH_PUBLIK)) {
      expect(rute, r).toContain(r);
    }
  });

  it("tiap rute di daftar putih menyertakan alasan yang berarti", () => {
    for (const [r, alasan] of Object.entries(BOLEH_PUBLIK)) {
      expect(alasan.length, r).toBeGreaterThan(30);
    }
  });
});
