// Lencana tray: Terhubung / Sebagian / Kosong / Tidak Aktif.
//
// Ia fungsi murni dan tidak menyentuh database, jadi tesnya boleh lengkap.
// Yang dijaga di sini bukan "apakah kodenya jalan" melainkan URUTAN
// pemeriksaannya — urutan itulah definisi keempat keadaan, dan menukarnya
// menghasilkan lencana yang terlihat masuk akal tapi salah.

import { describe, expect, it } from "vitest";
import { statusTray } from "@/server/otb-store";

describe("statusTray", () => {
  it("tray nonaktif tetap nonaktif walaupun portnya terpakai", () => {
    // Menggagalkan implementasi yang memeriksa jumlah port lebih dulu.
    expect(statusTray(false, 24, 17)).toBe("nonaktif");
  });

  it("semua port kosong → kosong", () => {
    expect(statusTray(true, 24, 0)).toBe("kosong");
  });

  it("tray tanpa port sama sekali → kosong, bukan terhubung", () => {
    // 0 >= 0 itu benar. Implementasi yang menaruh cek `terpakai >= total`
    // lebih dulu akan menyebut tray kosong "terhubung" dan mengundang
    // alokasi ke tray yang tidak punya lubang.
    expect(statusTray(true, 0, 0)).toBe("kosong");
  });

  it("semua port terpakai → terhubung", () => {
    expect(statusTray(true, 24, 24)).toBe("terhubung");
  });

  it("sebagian terpakai → sebagian", () => {
    expect(statusTray(true, 24, 17)).toBe("sebagian");
  });

  it("satu port terpakai dari 24 sudah bukan kosong", () => {
    expect(statusTray(true, 24, 1)).toBe("sebagian");
  });
});
