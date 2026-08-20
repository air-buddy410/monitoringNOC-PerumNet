// Status aset yang TIDAK dipantau SNMP.
//
// `192.168.100.10` sengaja tidak akan pernah masuk LibreNMS — perangkatnya
// memang tidak mendukung SNMP, dan pemilik memutuskan begitu (OPERATIONS
// §11.1). Sampai 20 Agustus aset seperti itu jatuh ke `warning` dengan alasan
// "belum dikenal LibreNMS → butuh perhatian operator".
//
// Alasan itu benar untuk aset yang SALAH KONFIGURASI, dan salah untuk aset
// yang memang tidak di-SNMP. Akibatnya perangkat itu kuning SELAMANYA:
// tidak ada yang bisa dikerjakan untuk membuatnya hijau, dan warna kuning
// yang tidak pernah berubah mengajari orang mengabaikan warna kuning.
//
// Padahal jawabannya sudah ada: probe TCP portal ini sudah memeriksa
// `192.168.100.10:1023` tiap 60 detik dan menjawab UP. Yang kurang cuma
// tautannya.

import { describe, expect, it } from "vitest";
import { statusDariProbe } from "@/server/device-store";

describe("statusDariProbe", () => {
  it("UP → online", () => {
    expect(statusDariProbe("UP")).toBe("online");
  });

  it("DOWN → offline", () => {
    expect(statusDariProbe("DOWN")).toBe("offline");
  });

  it("belum pernah diperiksa → warning, BUKAN online", () => {
    // Menebak "online" untuk yang belum diperiksa membuat layar berbohong ke
    // arah yang menenangkan — arah yang paling mahal.
    expect(statusDariProbe(null)).toBe("warning");
    expect(statusDariProbe(undefined)).toBe("warning");
  });

  it("status yang tidak dikenal → warning, bukan ditebak", () => {
    for (const aneh of ["", "up", "UNKNOWN", "PENDING", "SUCCESS"]) {
      expect(statusDariProbe(aneh), aneh).toBe("warning");
    }
  });
});
