// CPU dan RAM yang tidak terbaca disimpan sebagai `null`, bukan 0.
//
// Sampai 22 Agustus 2026 `metrics-store.ts` menulis `cpu ?? 0, ram ?? 0`.
// Perangkat yang melaporkan CPU tapi tidak memori — dan LibreNMS memang
// begitu untuk sebagian perangkat — menggambar garis RAM datar di 0%.
//
// Garis datar 0% terbaca sebagai "perangkat ini nyaris tidak memakai memori".
// Yang sebenarnya terjadi: sensornya tidak menjawab. Keduanya terlihat persis
// sama, dan yang pertama menenangkan — jenis kesalahan yang sama dengan
// `averageUptime: 0` pada laporan SLA dan jeda trafik yang digambar nol.

import { describe, expect, it } from "vitest";
import { advanceUsageSeries, generateUsageSeries, type UsagePoint } from "@/lib/mock-metrics";

describe("UsagePoint membolehkan tidak-terbaca", () => {
  it("cpu dan ram menerima null tanpa memaksa jadi angka", () => {
    // Penjaga tipe: kalau kolomnya dikembalikan jadi `number`, baris ini
    // gagal dikompilasi dan tesnya ikut merah.
    const titik: UsagePoint = { time: "10:00", cpu: null, ram: null };
    expect(titik.cpu).toBeNull();
    expect(titik.ram).toBeNull();
  });

  it("null dan 0 adalah dua hal berbeda", () => {
    const takTerbaca: UsagePoint = { time: "10:00", cpu: null, ram: 40 };
    const benarNol: UsagePoint = { time: "10:01", cpu: 0, ram: 40 };
    expect(takTerbaca.cpu).not.toBe(benarNol.cpu);
    // Sebuah perangkat yang benar-benar diam MEMANG boleh melaporkan 0%.
    expect(benarNol.cpu).toBe(0);
  });
});

describe("deret tiruan tetap berisi angka", () => {
  it("generateUsageSeries tidak pernah memuat null", () => {
    const deret = generateUsageSeries("uji");
    expect(deret.length).toBeGreaterThan(0);
    expect(deret.every((p) => typeof p.cpu === "number" && typeof p.ram === "number")).toBe(true);
  });

  it("advanceUsageSeries tetap jalan walau titik terakhir null", () => {
    // Cadangan di dalamnya hanya memenuhi tipe; ia tidak boleh melempar.
    const deret = advanceUsageSeries("uji-lanjut");
    expect(deret.at(-1)!.cpu).not.toBeNull();
    expect(Number.isFinite(deret.at(-1)!.cpu as number)).toBe(true);
  });
});
