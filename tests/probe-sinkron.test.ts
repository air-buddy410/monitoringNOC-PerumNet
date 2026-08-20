// Menautkan probe ke aset, dan membuat yang belum ada.
//
// 20 Agustus 2026: ketujuh `probe_targets` di produksi punya `asset_id`
// KOSONG. Probe berjalan tiap 60 detik dan hasilnya tidak pernah sampai ke
// daftar perangkat — termasuk untuk satu-satunya perangkat yang tidak
// mendukung SNMP, yang karena itu kuning selamanya.
//
// Menautkannya sekali dengan SQL menyelesaikan hari itu saja. Aset berikutnya
// akan mengulang jebakan yang sama, dan gejalanya tidak terlihat seperti
// kesalahan: perangkat baru sekadar muncul kuning dan tidak ada yang tahu
// kenapa.

import { describe, expect, it } from "vitest";
import { rencanaSinkronProbe } from "@/server/probe";

const aset = (assetId: string, managementIp: string | null, telnetPort?: number | null) => ({
  assetId,
  managementIp,
  telnetPort: telnetPort ?? null,
});

const sasaran = (id: string, address: string, assetId: string | null = null) => ({
  id,
  address,
  assetId,
});

describe("rencanaSinkronProbe", () => {
  it("menautkan sasaran yang alamatnya sama dengan aset", () => {
    const r = rencanaSinkronProbe([aset("a1", "10.0.0.1")], [sasaran("t1", "10.0.0.1")]);
    expect(r.ditautkan).toEqual([{ id: "t1", assetId: "a1" }]);
    expect(r.dibuat).toEqual([]);
  });

  it("membuat sasaran untuk aset yang belum punya", () => {
    const r = rencanaSinkronProbe([aset("a1", "10.0.0.1")], []);
    expect(r.dibuat).toEqual([{ assetId: "a1", address: "10.0.0.1", port: 443 }]);
  });

  it("OLT memakai telnet_port-nya, bukan 443", () => {
    // Menyambung ke 443 pada OLT yang hanya membuka 1023 berarti DOWN palsu
    // tiap 60 detik — alarm yang tidak menunjukkan apa pun tentang perangkatnya.
    const r = rencanaSinkronProbe([aset("a1", "192.168.100.10", 1023)], []);
    expect(r.dibuat).toEqual([
      { assetId: "a1", address: "192.168.100.10", port: 1023 },
    ]);
  });

  it("aset tanpa management_ip dilewati, bukan dibuatkan sasaran kosong", () => {
    const r = rencanaSinkronProbe([aset("a1", null), aset("a2", "  ")], []);
    expect(r.dibuat).toEqual([]);
    expect(r.ditautkan).toEqual([]);
  });

  it("sasaran yang SUDAH tertaut tidak disentuh lagi", () => {
    const r = rencanaSinkronProbe(
      [aset("a1", "10.0.0.1")],
      [sasaran("t1", "10.0.0.1", "a1")],
    );
    expect(r.ditautkan).toEqual([]);
    expect(r.dibuat).toEqual([]);
  });

  it("sasaran yang tertaut ke aset LAIN tidak dibajak", () => {
    // Kalau dua aset berbagi alamat, memindah tautannya diam-diam membuat
    // status satu perangkat muncul di perangkat lain.
    const r = rencanaSinkronProbe(
      [aset("a1", "10.0.0.1")],
      [sasaran("t1", "10.0.0.1", "a-lain")],
    );
    expect(r.ditautkan).toEqual([]);
    expect(r.dibuat).toEqual([]);
  });

  it("alamat yang sudah punya sasaran TIDAK dibuatkan sasaran kedua", () => {
    // Termasuk sasaran yang sengaja dinonaktifkan: menonaktifkan adalah cara
    // berhenti memantau, dan sinkron tidak boleh menghidupkannya kembali
    // lewat pintu belakang.
    const r = rencanaSinkronProbe([aset("a1", "10.0.0.1")], [sasaran("t1", "10.0.0.1")]);
    expect(r.dibuat).toEqual([]);
  });

  it("tidak pernah mengusulkan penghapusan — berhenti memantau itu keputusan", () => {
    const r = rencanaSinkronProbe([], [sasaran("t1", "10.9.9.9")]);
    expect(r).not.toHaveProperty("dihapus");
    expect(r.dibuat).toEqual([]);
    expect(r.ditautkan).toEqual([]);
  });

  it("pencocokan alamat mengabaikan spasi tepi dan huruf besar", () => {
    const r = rencanaSinkronProbe(
      [aset("a1", " 10.0.0.1 ")],
      [sasaran("t1", "10.0.0.1")],
    );
    expect(r.ditautkan).toEqual([{ id: "t1", assetId: "a1" }]);
  });
});
