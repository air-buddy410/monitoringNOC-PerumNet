// Plugin Better Auth: satu pintu login portal.
//
// Endpoint `POST /api/auth/sign-in/portal` menggantikan `/sign-in/email`
// sebagai satu-satunya jalan masuk. Yang menentukan bagaimana password
// diperiksa adalah SERVER, bukan frontend:
//
//   AUTH_PROVIDER=MAILSERVER → password EMAIL, diperiksa ke mailcow (IMAP)
//   AUTH_PROVIDER=LOCAL      → hash Better Auth seperti sebelumnya
//
// Kecuali untuk akun yang ditandai `allowLocalLogin` — akun darurat. Kalau
// mailserver mati dan tidak ada jalan masuk lain, tidak ada seorang pun bisa
// masuk untuk memperbaikinya. Itu pintu kebakaran, dan setiap pemakaiannya
// tercatat di audit log.
//
// Frontend tidak perlu tahu mode mana yang aktif: kirim email + password ke
// satu alamat ini, tangani jawabannya. Saat Authentik dipasang nanti, yang
// berubah hanya isi berkas ini.

import { randomUUID } from "node:crypto";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { eq } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/db";
import { user as userTable } from "@/db/auth-schema";
import { auditLogs } from "@/db/schema";
import {
  authProviderMode,
  verifyMailserverPassword,
  type ImapProbe,
} from "@/server/mail-auth";

const bodySchema = z.object({
  email: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(512),
});

/** Bagian depan alamat yang masuk akal — sengaja ketat, bukan permisif. */
const BAGIAN_DEPAN = /^[a-z0-9._%+-]+$/;
/** Domain yang masuk akal: ada titiknya, ada akhirannya. */
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

/**
 * Domain yang dipakai saat orang mengetik username saja.
 *
 * Kosong = fitur mati, dan itu bawaannya. Nilai yang tidak berbentuk domain
 * juga dianggap kosong — sama seperti `authProviderMode()` dan
 * `outwardMode()`, salah ketik jatuh ke sisi yang tidak mengubah perilaku,
 * bukan ke tebakan.
 */
export function domainLoginBawaan(): string | null {
  const raw = (process.env.LOGIN_DEFAULT_DOMAIN ?? "").trim().toLowerCase();
  if (!raw || !DOMAIN.test(raw)) return null;
  return raw;
}

/**
 * Mengubah apa yang diketik orang menjadi alamat yang dicari di database.
 *
 * Yang memuat "@" tidak disentuh selain dirapikan — jalur lama tetap persis
 * seperti sebelumnya. Yang tidak memuat "@" dilengkapi domain bawaan.
 *
 * **Sengaja BUKAN dengan mencocokkan bagian depan alamat yang tersimpan.**
 * Cara itu terlihat lebih pintar dan justru berbahaya di sini: portal memuat
 * `admin@perumnet.id` DAN `admin@perumnet.co.id`, jadi "admin" jadi ambigu
 * dan pemenangnya ditentukan urutan baris — pada akun darurat, tepat ketika
 * keadaan sedang buruk. Dengan domain bawaan, "admin" selalu berarti akun
 * yang sama.
 *
 * Username yang tidak masuk akal dikembalikan apa adanya, bukan disambung.
 * Ia lalu tidak cocok dengan akun mana pun dan berhenti di "akun tidak
 * ditemukan" — jalur yang sudah ada, dengan pesan yang sudah benar.
 */
export function normalkanIdentitas(
  masukan: string,
  domain: string | null,
): string {
  const bersih = (masukan ?? "").trim().toLowerCase();
  if (bersih.includes("@")) return bersih;
  if (!domain || !BAGIAN_DEPAN.test(bersih)) return bersih;
  return `${bersih}@${domain}`;
}

/** Satu kalimat untuk semua kegagalan kredensial — jangan bocorkan mana yang salah. */
const KREDENSIAL_SALAH = "Email atau password salah.";

/**
 * Dibedakan DENGAN SENGAJA dari pesan di atas: memberitahu "password salah"
 * saat mailserver-nya yang mati akan membuat orang mereset password email
 * yang sebenarnya tidak bermasalah.
 */
const MAILSERVER_MATI =
  "Mailserver sedang tidak bisa dihubungi, jadi login belum bisa diproses. Coba lagi sebentar lagi atau hubungi IT.";

type AuditParams = {
  actorUserId: string | null;
  actorLabel: string;
  action: string;
  entityId: string;
  detail?: Record<string, unknown>;
};

/**
 * Mencatat percobaan login — yang berhasil maupun yang gagal.
 *
 * Password tidak pernah ikut, termasuk panjangnya. Kegagalan mencatat tidak
 * boleh menggagalkan login: audit yang rusak bukan alasan mengunci orang di
 * luar sistemnya sendiri.
 */
async function catat(params: AuditParams): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      id: randomUUID(),
      actorUserId: params.actorUserId,
      actorLabel: params.actorLabel,
      action: params.action,
      entityType: "user",
      entityId: params.entityId,
      detail: params.detail ?? null,
    });
  } catch {
    /* audit gagal ditulis — login tetap diproses */
  }
}

export interface PortalAuthOptions {
  /** Disuntik pada tes supaya seluruh alur teruji tanpa mailserver sungguhan. */
  probe?: ImapProbe;
  /** Batas percobaan: jumlah maksimum dalam satu jendela (detik). */
  rateLimit?: { window: number; max: number };
}

export const portalAuth = (options: PortalAuthOptions = {}) => {
  const batas = options.rateLimit ?? { window: 60, max: 5 };

  return {
    id: "perumnet-portal-auth",
    endpoints: {
      signInPortal: createAuthEndpoint(
        "/sign-in/portal",
        { method: "POST", body: bodySchema },
        async (ctx) => {
          // Orang boleh mengetik username saja; yang dicari tetap alamat
          // lengkap, karena itu yang dikenal database DAN mailcow.
          const email = normalkanIdentitas(ctx.body.email, domainLoginBawaan());
          const password = ctx.body.password;
          const mode = authProviderMode();

          // Pencocokan email tidak peka huruf besar-kecil: ponsel sering
          // mengapitalkan huruf pertama sendiri, dan alamat email memang
          // tidak peka huruf. Yang ditolak karena itu terbaca seperti
          // "password salah", lalu orang mereset password yang baik-baik saja.
          const [akun] = await db
            .select({
              id: userTable.id,
              name: userTable.name,
              email: userTable.email,
              role: userTable.role,
              allowLocalLogin: userTable.allowLocalLogin,
            })
            .from(userTable)
            .where(eq(userTable.email, email))
            .limit(1);

          if (!akun) {
            await catat({
              actorUserId: null,
              actorLabel: email,
              action: "login.gagal",
              entityId: "tidak-dikenal",
              detail: { mode, alasan: "akun tidak ditemukan" },
            });
            throw new APIError("UNAUTHORIZED", { message: KREDENSIAL_SALAH });
          }

          // ── Di mana password diperiksa ──────────────────────────
          //
          // Mode MAILSERVER memindahkan pemeriksaan dari hash lokal ke
          // mailserver. Hash lokal tetap dipakai untuk akun darurat — kalau
          // tidak, mailserver yang mati berarti tidak ada seorang pun bisa
          // masuk untuk membetulkannya.
          //
          // Tidak ada jalan mundur diam-diam. Mailserver tak terjawab berarti
          // login GAGAL, bukan jatuh kembali ke hash lokal — jatuh balik
          // seperti itu membuat mematikan mailbox tidak lagi berarti mencabut
          // akses.
          const lewatMailserver = mode === "MAILSERVER" && !akun.allowLocalLogin;

          if (lewatMailserver) {
            const hasil = await verifyMailserverPassword(
              akun.email,
              password,
              options.probe,
            );
            if (!hasil.ok) {
              await catat({
                actorUserId: akun.id,
                actorLabel: akun.email,
                action: "login.gagal",
                entityId: akun.id,
                detail:
                  hasil.reason === "REJECTED"
                    ? { mode, alasan: "ditolak mailserver" }
                    : { mode, alasan: "mailserver tidak terjawab", detail: hasil.detail },
              });
              throw new APIError(
                hasil.reason === "REJECTED" ? "UNAUTHORIZED" : "SERVICE_UNAVAILABLE",
                {
                  message:
                    hasil.reason === "REJECTED" ? KREDENSIAL_SALAH : MAILSERVER_MATI,
                },
              );
            }
          } else {
            const accounts = await ctx.context.internalAdapter.findAccounts(
              akun.id,
            );
            const credential = accounts?.find(
              (account) => account.providerId === "credential",
            );
            const hash = credential?.password;
            if (!hash) {
              await catat({
                actorUserId: akun.id,
                actorLabel: akun.email,
                action: "login.gagal",
                entityId: akun.id,
                detail: { mode, alasan: "akun tanpa password lokal" },
              });
              throw new APIError("UNAUTHORIZED", { message: KREDENSIAL_SALAH });
            }
            const cocok = await ctx.context.password.verify({ hash, password });
            if (!cocok) {
              await catat({
                actorUserId: akun.id,
                actorLabel: akun.email,
                action: "login.gagal",
                entityId: akun.id,
                detail: { mode, alasan: "password lokal salah" },
              });
              throw new APIError("UNAUTHORIZED", { message: KREDENSIAL_SALAH });
            }
          }

          const pengguna = await ctx.context.internalAdapter
            .findUserByEmail(akun.email)
            .then((hasil) => hasil?.user);
          if (!pengguna) {
            throw new APIError("UNAUTHORIZED", { message: KREDENSIAL_SALAH });
          }

          const session = await ctx.context.internalAdapter.createSession(
            pengguna.id,
          );
          if (!session) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Sesi gagal dibuat.",
            });
          }
          await setSessionCookie(ctx, { session, user: pengguna });

          await catat({
            actorUserId: akun.id,
            actorLabel: akun.email,
            action: "login.berhasil",
            entityId: akun.id,
            // Pemakaian pintu darurat harus terlihat, bukan tersembunyi.
            detail: { mode, jalur: lewatMailserver ? "mailserver" : "lokal-darurat" },
          });

          return ctx.json({
            user: {
              id: akun.id,
              name: akun.name,
              email: akun.email,
              role: akun.role,
            },
          });
        },
      ),
    },
    rateLimit: [
      {
        pathMatcher(path: string) {
          return path.startsWith("/sign-in/portal");
        },
        window: batas.window,
        max: batas.max,
      },
    ],
  };
};
