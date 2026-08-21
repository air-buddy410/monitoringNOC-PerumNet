// Satuan panjang kabel — satu sumber untuk seluruh layar.
//
// Saat ditulis, konversi meter→kilometer sudah tersalin di dua komponen.
// Dua salinan rumus yang sama selalu berakhir berbeda begitu ada yang
// memperbaiki pembulatan di satu tempat saja, dan sesudah itu panjang jalur
// di layar kabel tidak sama dengan panjang jalur di panel trace.

import { describe, expect, it } from "vitest";
import { formatPanjang } from "@/lib/noc-format";

describe("formatPanjang", () => {
  it("di bawah 1 km tetap meter, tanpa desimal", () => {
    expect(formatPanjang(850)).toBe("850 m");
    expect(formatPanjang(999)).toBe("999 m");
  });

  it("1 km ke atas jadi kilometer, maksimal dua desimal", () => {
    expect(formatPanjang(1000)).toBe("1 km");
    expect(formatPanjang(3250)).toBe("3,25 km");
    expect(formatPanjang(11400)).toBe("11,4 km");
  });

  it("null berarti BELUM DIUKUR, bukan nol", () => {
    // Server tidak pernah menjumlahkan null sebagai nol; layar juga tidak
    // boleh menampilkannya sebagai "0 m".
    expect(formatPanjang(null)).toBe("Belum diukur");
    expect(formatPanjang(undefined)).toBe("Belum diukur");
  });

  it("nol adalah nol — bukan 'belum diukur'", () => {
    // Kabel sepanjang 0 m tidak masuk akal, tapi kalau datanya begitu, layar
    // harus menunjukkannya apa adanya supaya salah datanya terlihat.
    expect(formatPanjang(0)).toBe("0 m");
  });

  it("total yang belum lengkap diberi awalan ≥", () => {
    // Angka tanpa penanda terbaca sebagai jarak pasti, dan dipakai menakar
    // jarak-ke-gangguan di OTDR.
    expect(formatPanjang(2300, false)).toBe("≥ 2,3 km");
    expect(formatPanjang(850, false)).toBe("≥ 850 m");
  });

  it("nilai tak masuk akal jadi —, bukan NaN di layar", () => {
    expect(formatPanjang(Number.NaN)).toBe("—");
    expect(formatPanjang(Number.POSITIVE_INFINITY)).toBe("—");
  });
});
