// Satu-satunya pemformat bitrate di repo ini.
//
// Yang dijaga bukan kerapian melainkan KECOCOKAN: angka di portal harus sama
// dengan angka yang sama di LibreNMS. Laju jaringan memakai awalan desimal
// (1 Gbps = 1e9 bps); memakai 1024 membuat portal meleset ~7% — terlalu kecil
// untuk terlihat salah, terlalu besar untuk diabaikan.

import { describe, expect, it } from "vitest";
import { formatBitrate } from "@/lib/noc-format";

describe("formatBitrate", () => {
  it("memakai pembagi 1000, bukan 1024", () => {
    // Kalau seseorang menggantinya dengan 1024, angka ini jadi "0,93 Gbps".
    expect(formatBitrate(1_000_000_000)).toBe("1 Gbps");
    expect(formatBitrate(1_000_000)).toBe("1 Mbps");
    expect(formatBitrate(1_000)).toBe("1 kbps");
  });

  it("uplink produksi terbaca seperti yang dilaporkan router", () => {
    expect(formatBitrate(3_034_700_000)).toBe("3,03 Gbps");
    expect(formatBitrate(315_300_000)).toBe("315,3 Mbps");
  });

  it("null dan undefined jadi '—', TIDAK PERNAH '0 bps'", () => {
    // Aturan §14 nomor 2: laju yang belum ada bukan laju nol.
    expect(formatBitrate(null)).toBe("—");
    expect(formatBitrate(undefined)).toBe("—");
    expect(formatBitrate(Number.NaN)).toBe("—");
    // Nol yang jujur tetap ditampilkan sebagai nol.
    expect(formatBitrate(0)).toBe("0 bps");
  });

  it("bps utuh tidak diberi desimal", () => {
    expect(formatBitrate(999)).toBe("999 bps");
    expect(formatBitrate(1)).toBe("1 bps");
  });

  it("dua desimal di bawah 10, satu di atasnya", () => {
    expect(formatBitrate(1_234_000)).toBe("1,23 Mbps");
    expect(formatBitrate(12_340_000)).toBe("12,3 Mbps");
  });

  it("counter yang mundur tidak jadi angka raksasa", () => {
    // Reset counter router bisa menghasilkan selisih negatif; ia harus
    // terbaca sebagai negatif, bukan disembunyikan atau di-Math.abs diam-diam.
    expect(formatBitrate(-1_000_000)).toBe("-1 Mbps");
  });
});
