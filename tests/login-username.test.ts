// Masuk dengan username saja, tanpa mengetik "@perumnet.id".
//
// Diminta pemilik 20 Agustus 2026. Label di layar login sudah lama berbunyi
// "Username atau Email"; yang belum ada justru sisi servernya.
//
// Cara menyelesaikannya PENTING. Mencocokkan bagian depan alamat
// (`split_part(email,'@',1)`) terlihat lebih pintar dan justru berbahaya di
// sini: NOC punya `admin@perumnet.id` DAN `admin@perumnet.co.id`. Mengetik
// "admin" jadi ambigu, dan yang menang ditentukan urutan baris — pada akun
// darurat, tepat ketika keadaan sedang buruk.
//
// Jadi yang dipakai satu domain bawaan: username + "@" + LOGIN_DEFAULT_DOMAIN.
// Deterministik, dan "admin" selalu berarti akun yang sama.

import { afterEach, describe, expect, it } from "vitest";
import { domainLoginBawaan, normalkanIdentitas } from "@/server/auth-portal";

afterEach(() => {
  delete process.env.LOGIN_DEFAULT_DOMAIN;
});

describe("normalkanIdentitas", () => {
  it("username polos dilengkapi domain bawaan", () => {
    expect(normalkanIdentitas("budi_prabhawa", "perumnet.id")).toBe(
      "budi_prabhawa@perumnet.id",
    );
  });

  it("alamat lengkap TIDAK disentuh — jalur lama tetap apa adanya", () => {
    expect(normalkanIdentitas("orang@lain.co.id", "perumnet.id")).toBe(
      "orang@lain.co.id",
    );
  });

  it("huruf besar diturunkan — ponsel sering mengapitalkan huruf pertama", () => {
    expect(normalkanIdentitas("Budi_Prabhawa", "perumnet.id")).toBe(
      "budi_prabhawa@perumnet.id",
    );
    expect(normalkanIdentitas("Orang@Perumnet.ID", "perumnet.id")).toBe(
      "orang@perumnet.id",
    );
  });

  it("tanpa domain bawaan, username polos dibiarkan — fitur mati, bukan menebak", () => {
    expect(normalkanIdentitas("budi_prabhawa", null)).toBe("budi_prabhawa");
  });

  it("username yang tidak masuk akal tidak disambung begitu saja", () => {
    for (const buruk of ["budi prabhawa", "budi/../admin", "budi@", "", "  "]) {
      const hasil = normalkanIdentitas(buruk, "perumnet.id");
      expect(hasil, buruk).not.toBe(`${buruk.trim().toLowerCase()}@perumnet.id`);
    }
  });

  it("spasi di tepi dibuang sebelum disambung", () => {
    expect(normalkanIdentitas("  budi_prabhawa  ", "perumnet.id")).toBe(
      "budi_prabhawa@perumnet.id",
    );
  });
});

describe("domainLoginBawaan", () => {
  it("kosong bila tidak disetel — perilaku hari ini tidak berubah sendiri", () => {
    expect(domainLoginBawaan()).toBeNull();
  });

  it("membaca LOGIN_DEFAULT_DOMAIN", () => {
    process.env.LOGIN_DEFAULT_DOMAIN = "perumnet.id";
    expect(domainLoginBawaan()).toBe("perumnet.id");
  });

  it("domain yang salah ketik diperlakukan sebagai tidak disetel", () => {
    for (const buruk of ["perumnet", "@perumnet.id", "perumnet .id", "http://perumnet.id"]) {
      process.env.LOGIN_DEFAULT_DOMAIN = buruk;
      expect(domainLoginBawaan(), buruk).toBeNull();
    }
  });

  it("huruf besar & spasi dirapikan", () => {
    process.env.LOGIN_DEFAULT_DOMAIN = "  PerumNet.ID  ";
    expect(domainLoginBawaan()).toBe("perumnet.id");
  });
});
