// Tembok baca-saja sambungan CLI ke OLT.
//
// Masuk ke konsol OLT berarti memegang kemampuan mengubah perangkat produksi.
// Aturan portal ini tidak berubah karena itu: TIDAK PERNAH mengubah, membuat,
// atau menghapus apa pun. Uji di bawah yang memaksakannya — bukan komentar,
// bukan niat baik.

import net from "node:net";
import { describe, expect, it, vi } from "vitest";
import {
  OltCliError,
  PERINTAH_BOLEH,
  PERINTAH_TERLARANG,
  PerintahDitolak,
  bacaKredensial,
  jalankanPerintahBaca,
  kirimPerintah,
  periksaPerintahBaca,
} from "@/server/olt-cli";

describe("daftar putih tidak boleh kemasukan perintah yang mengubah", () => {
  it("tidak satu pun kata terlarang ada di daftar putih", () => {
    const bocor = PERINTAH_TERLARANG.filter((k) => PERINTAH_BOLEH.has(k));
    expect(bocor).toEqual([]);
  });

  it("setiap kata terlarang benar-benar DITOLAK, bukan sekadar absen", () => {
    for (const kata of PERINTAH_TERLARANG) {
      expect(() => periksaPerintahBaca(`${kata} sesuatu`), kata).toThrow(PerintahDitolak);
    }
  });
});

describe("periksaPerintahBaca", () => {
  it.each(["show version", "display board 0", "interface gpon 0/1", "exit", "?"])(
    "%s diizinkan", (p) => expect(() => periksaPerintahBaca(p)).not.toThrow());

  // Diperiksa KATA PERTAMA. Kalau ini pencocokan pola di tengah kalimat,
  // menyisipkan "show" di belakang perintah yang mengubah akan meloloskannya.
  it("perintah mengubah TIDAK lolos hanya karena mengandung kata 'show'", () => {
    expect(() => periksaPerintahBaca("reboot show")).toThrow(PerintahDitolak);
    expect(() => periksaPerintahBaca("no shutdown show")).toThrow(PerintahDitolak);
  });

  // Ini jalur pintas yang paling mudah terlewat: satu baris, dua perintah.
  it.each([
    "show version; reboot",
    "show version\nreboot",
    "show version\r\nno shutdown",
    "show version | delete all",
    "show version && reboot",
  ])("penumpukan perintah ditolak: %s", (p) => {
    expect(() => periksaPerintahBaca(p)).toThrow(/pemisah/);
  });

  it("huruf besar tidak membuka jalan", () => {
    expect(() => periksaPerintahBaca("REBOOT")).toThrow(PerintahDitolak);
    expect(() => periksaPerintahBaca("Delete config")).toThrow(PerintahDitolak);
  });

  it("baris kosong dilewati tanpa keluhan", () => {
    expect(() => periksaPerintahBaca("   ")).not.toThrow();
  });
});

describe("kirimPerintah — satu-satunya pintu keluar", () => {
  it("memeriksa SEBELUM menulis: penulis tidak pernah dipanggil saat ditolak", () => {
    const tulis = vi.fn();
    expect(() => kirimPerintah(tulis, "reboot")).toThrow(PerintahDitolak);
    expect(tulis).not.toHaveBeenCalled();
  });

  it("perintah sah diteruskan dengan CRLF", () => {
    const tulis = vi.fn();
    kirimPerintah(tulis, "show version");
    expect(tulis).toHaveBeenCalledWith("show version\r\n");
  });
});

describe("jalankanPerintahBaca menolak SEBELUM menyentuh perangkat", () => {
  // Perangkat produksi tidak perlu tahu bahwa kita sempat salah. Kalau satu
  // perintah saja ditolak, tidak ada koneksi yang dibuka sama sekali.
  it("tidak membuka soket bila ada satu perintah terlarang", async () => {
    const spy = vi.spyOn(net, "Socket");
    await expect(
      jalankanPerintahBaca(
        { host: "192.0.2.1", port: 1023, credentialRef: "UJI_CRED" },
        ["show version", "reboot"],
      ),
    ).rejects.toThrow(PerintahDitolak);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("tidak membuka soket bila kredensialnya belum ada", async () => {
    const spy = vi.spyOn(net, "Socket");
    await expect(
      jalankanPerintahBaca(
        { host: "192.0.2.1", port: 1023, credentialRef: "TIDAK_ADA_DI_ENV" },
        ["show version"],
      ),
    ).rejects.toThrow(OltCliError);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("bacaKredensial", () => {
  it("kolomnya menyimpan NAMA env var, bukan kata sandi", () => {
    // Kalau seseorang menaruh kata sandi langsung di kolom ini, ia akan
    // tersimpan di database dan ikut ke cadangan. Ditolak di muka.
    expect(() => bacaKredensial("admin:rahasia123")).toThrow(/NAMA, bukan kata sandi/);
    expect(() => bacaKredensial("huruf kecil")).toThrow(/nama env var yang sah/);
  });

  it("kosong ditolak dengan pesan yang menyebut sebabnya", () => {
    expect(() => bacaKredensial(null)).toThrow(/belum menunjuk nama env var/);
  });

  it("bentuk user:password dibaca benar", () => {
    vi.stubEnv("UJI_OLT_CRED", "pemantau:kata:sandi:berisi:titikdua");
    const k = bacaKredensial("UJI_OLT_CRED");
    expect(k.user).toBe("pemantau");
    expect(k.password).toBe("kata:sandi:berisi:titikdua");
    vi.unstubAllEnvs();
  });

  it("isi tanpa titik dua ditolak", () => {
    vi.stubEnv("UJI_OLT_CRED2", "tanpapemisah");
    expect(() => bacaKredensial("UJI_OLT_CRED2")).toThrow(/user:password/);
    vi.unstubAllEnvs();
  });
});

describe("pisahkanIac — negosiasi telnet", () => {
  // Tanpa ini HSGQ menerima "show gpon onu detail-info" sebagai
  // "show gpononudetail-info" — spasinya hilang, perintahnya ditolak, dan
  // sebabnya tidak terlihat sama sekali dari pesan galatnya.
  it("DO dijawab WONT, WILL dijawab DONT", async () => {
    const { pisahkanIac } = await import("@/server/olt-cli");
    // IAC DO ECHO (255,253,1) + IAC WILL SGA (255,251,3)
    const masuk = Uint8Array.from([255, 253, 1, 255, 251, 3, 0x68, 0x69]);
    const { teks, balas } = pisahkanIac(masuk);
    expect([...balas]).toEqual([255, 252, 1, 255, 254, 3]);
    expect(teks.toString()).toBe("hi");
  });

  it("byte teks biasa tidak tersentuh", async () => {
    const { pisahkanIac } = await import("@/server/olt-cli");
    const { teks, balas } = pisahkanIac(Uint8Array.from(Buffer.from("show version")));
    expect(teks.toString()).toBe("show version");
    expect(balas.length).toBe(0);
  });
});
