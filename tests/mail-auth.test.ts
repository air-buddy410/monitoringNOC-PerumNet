// Penjagaan verifikasi kredensial ke mailserver (integrasi mailcow).
// Semuanya fungsi murni — tidak menyentuh jaringan, tidak butuh mailserver.

import { afterEach, describe, expect, it } from "vitest";
import {
  authProviderMode,
  credentialRejection,
  imapHostFrom,
  isTaggedOk,
  mailserverHost,
  quoteImap,
  verifyMailserverPassword,
} from "@/server/mail-auth";

const envAsli = { ...process.env };

afterEach(() => {
  process.env = { ...envAsli };
});

describe("credentialRejection", () => {
  it("menolak baris baru — bisa menyisipkan perintah IMAP sendiri", () => {
    expect(credentialRejection("rahasia\r\na2 LOGOUT")).not.toBeNull();
    expect(credentialRejection("rahasia\npalsu")).not.toBeNull();
    expect(credentialRejection("rahasia\0")).not.toBeNull();
  });

  it("menolak kosong dan yang kepanjangan", () => {
    expect(credentialRejection("")).not.toBeNull();
    expect(credentialRejection("x".repeat(513))).not.toBeNull();
  });

  it("meloloskan password wajar, termasuk yang bersimbol", () => {
    expect(credentialRejection('P@ssw0rd "kutip" \\ backslash')).toBeNull();
  });
});

describe("quoteImap", () => {
  it("mendahului backslash dan tanda kutip", () => {
    expect(quoteImap('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});

describe("isTaggedOk", () => {
  it("membaca OK / NO / BAD untuk tag yang cocok", () => {
    expect(isTaggedOk("a1 OK LOGIN completed", "a1")).toBe(true);
    expect(isTaggedOk("a1 NO LOGIN failed", "a1")).toBe(false);
    expect(isTaggedOk("a1 BAD syntax", "a1")).toBe(false);
  });

  it("null bila jawabannya belum lengkap", () => {
    expect(isTaggedOk("* OK menunggu", "a1")).toBeNull();
  });
});

describe("imapHostFrom", () => {
  it("mengambil nama host, dengan atau tanpa skema", () => {
    expect(imapHostFrom("https://mail.perumnet.id")).toBe("mail.perumnet.id");
    expect(imapHostFrom("mail.perumnet.id")).toBe("mail.perumnet.id");
    expect(imapHostFrom("https://mail.perumnet.id/api/v1/")).toBe(
      "mail.perumnet.id",
    );
  });

  it("melempar bila kosong", () => {
    expect(() => imapHostFrom("")).toThrow();
  });
});

describe("authProviderMode", () => {
  it("bawaannya LOCAL", () => {
    delete process.env.AUTH_PROVIDER;
    expect(authProviderMode()).toBe("LOCAL");
  });

  it("MAILSERVER bila disetel, tidak peka huruf", () => {
    process.env.AUTH_PROVIDER = "mailserver";
    expect(authProviderMode()).toBe("MAILSERVER");
  });

  it("salah ketik jatuh ke LOCAL, bukan diam-diam mengubah cara masuk", () => {
    process.env.AUTH_PROVIDER = "MAILSERVR";
    expect(authProviderMode()).toBe("LOCAL");
  });
});

describe("mailserverHost", () => {
  it("null bila MAILSERVER_URL belum disetel atau tidak terbaca", () => {
    delete process.env.MAILSERVER_URL;
    expect(mailserverHost()).toBeNull();
    process.env.MAILSERVER_URL = "   ";
    expect(mailserverHost()).toBeNull();
  });
});

describe("verifyMailserverPassword", () => {
  it("konfigurasi belum ada → UNREACHABLE, BUKAN REJECTED", async () => {
    delete process.env.MAILSERVER_URL;
    const hasil = await verifyMailserverPassword("a@perumnet.id", "rahasia");
    // Bedanya penting: REJECTED berarti "passwordmu salah" dan membuat orang
    // mereset password email yang sebenarnya baik-baik saja.
    expect(hasil).toEqual({
      ok: false,
      reason: "UNREACHABLE",
      detail: "MAILSERVER_URL belum disetel.",
    });
  });

  it("akun tanpa email → UNREACHABLE, bukan lolos", async () => {
    process.env.MAILSERVER_URL = "https://mail.perumnet.id";
    const hasil = await verifyMailserverPassword("", "rahasia");
    expect(hasil.ok).toBe(false);
  });

  it("meneruskan host hasil parsing ke probe", async () => {
    process.env.MAILSERVER_URL = "https://mail.perumnet.id/apapun";
    let dilihat = "";
    const hasil = await verifyMailserverPassword(
      "a@perumnet.id",
      "rahasia",
      async (host) => {
        dilihat = host;
        return { ok: true };
      },
    );
    expect(dilihat).toBe("mail.perumnet.id");
    expect(hasil.ok).toBe(true);
  });

  it("probe melempar → UNREACHABLE, dan password tidak ikut ke pesan galat", async () => {
    process.env.MAILSERVER_URL = "https://mail.perumnet.id";
    const hasil = await verifyMailserverPassword(
      "a@perumnet.id",
      "password-super-rahasia",
      async () => {
        throw new Error("koneksi ditolak");
      },
    );
    expect(hasil).toEqual({
      ok: false,
      reason: "UNREACHABLE",
      detail: "koneksi ditolak",
    });
    expect(JSON.stringify(hasil)).not.toContain("password-super-rahasia");
  });
});
