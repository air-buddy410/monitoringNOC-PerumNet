// Konfigurasi Better Auth (autentikasi & sesi, sesuai tech stack PRD).
// Email + kata sandi; setiap user membawa field `role` untuk RBAC
// (admin | noc | engineer | manajemen — default engineer).
//
// Sumber kebenaran password ditentukan `AUTH_PROVIDER` (lihat mail-auth.ts):
//
//   MAILSERVER → password EMAIL orang itu, diperiksa ke mailcow lewat IMAP.
//                `/sign-in/email` dan `/sign-up/email` DITUTUP — kalau tidak,
//                hash lokal tetap jadi jalan masuk kedua dan seluruh
//                integrasi ini cuma hiasan.
//   LOCAL      → hash Better Auth seperti sebelumnya.
//
// Kedua mode masuk lewat satu alamat yang sama: `/api/auth/sign-in/portal`.

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import { portalAuth } from "@/server/auth-portal";
import { authProviderMode } from "@/server/mail-auth";

const localTrustedOrigins = [
  "http://localhost:3002",
  "http://127.0.0.1:3002",
  "http://10.10.2.235:3002",
];

const configuredTrustedOrigins = (process.env.AUTH_TRUSTED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const lewatMailserver = authProviderMode() === "MAILSERVER";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  // Better Auth validates Origin for state-changing requests. Keep local
  // development and LAN preview origins explicit; production origins can be
  // supplied through AUTH_TRUSTED_ORIGINS as a comma-separated allowlist.
  trustedOrigins: [...new Set([...localTrustedOrigins, ...configuredTrustedOrigins])],
  emailAndPassword: lewatMailserver
    ? // Menutup /sign-in/email, /sign-up/email, dan /change-password sekaligus.
      // Password lokal tidak lagi berarti apa-apa di mode ini kecuali untuk
      // akun darurat, yang masuk lewat /sign-in/portal.
      { enabled: false }
    : {
        enabled: true,
        minPasswordLength: 8,
        // Pendaftaran mandiri ditutup permanen: akun dibuat admin lewat
        // POST /api/users. Sebelum ini siapa pun yang bisa menjangkau
        // aplikasi bisa membuat akun `engineer` lalu membaca seluruh data NOC.
        disableSignUp: true,
      },
  // Pembatas percobaan dinyalakan di semua lingkungan, bukan hanya produksi
  // (bawaan Better Auth: hanya produksi). Password yang lewat sini adalah
  // password email — saluran reset untuk akun lain — jadi menebaknya tidak
  // boleh murah, termasuk di staging.
  rateLimit: {
    enabled: true,
    window: 60,
    max: 60,
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "engineer",
        input: false, // peran tidak boleh di-set sendiri saat daftar
      },
    },
  },
  plugins: [portalAuth()],
});
