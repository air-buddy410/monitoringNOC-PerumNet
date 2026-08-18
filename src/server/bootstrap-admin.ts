// Bootstrap akun Admin NOC pertama: RBAC butuh minimal satu admin agar
// pengaturan peran bisa dilakukan dari dalam aplikasi. Dijalankan sekali
// saat server start (instrumentation); tidak melakukan apa-apa bila sudah
// ada user ber-peran admin.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { createPortalUser } from "@/server/user-provisioning";

const DEFAULT_ADMIN_EMAIL = "admin@perumnet.id";
const LEGACY_DEFAULT_ADMIN_EMAIL = "admin@perumnet.co.id";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? DEFAULT_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "perumnet123";
const ADMIN_NAME = process.env.ADMIN_NAME ?? "Admin NOC";

export async function ensureAdminUser() {
  const [existingAdmin] = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.role, "admin"))
    .limit(1);

  // Migrasi aman untuk instalasi lokal yang sebelumnya memakai default lama.
  // Nilai ADMIN_EMAIL eksplisit selalu menang dan tidak pernah ditimpa otomatis.
  if (existingAdmin) {
    const shouldMigrateLegacyDefault =
      !process.env.ADMIN_EMAIL &&
      existingAdmin.email === LEGACY_DEFAULT_ADMIN_EMAIL;

    if (shouldMigrateLegacyDefault) {
      const [existingNewEmail] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, DEFAULT_ADMIN_EMAIL))
        .limit(1);

      if (!existingNewEmail) {
        await db
          .update(user)
          .set({ email: DEFAULT_ADMIN_EMAIL })
          .where(eq(user.id, existingAdmin.id));
        console.log(`[bootstrap] email Admin NOC diperbarui: ${DEFAULT_ADMIN_EMAIL}`);
      }
    }
    return;
  }

  const [existingByEmail] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, ADMIN_EMAIL))
    .limit(1);

  let adminId = existingByEmail?.id;
  if (!adminId) {
    // Admin pertama sekaligus AKUN DARURAT: ia tetap punya password lokal
    // walau AUTH_PROVIDER=MAILSERVER. Tanpa satu pun akun seperti ini,
    // mailserver yang mati berarti tidak ada yang bisa masuk untuk
    // memperbaikinya — pola yang sama dipakai CRM (admin@perumnet.id).
    const dibuat = await createPortalUser({
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      role: "admin",
      password: ADMIN_PASSWORD,
      allowLocalLogin: true,
    });
    if (!dibuat.ok) {
      console.error(`[bootstrap] akun Admin NOC gagal dibuat: ${dibuat.error}`);
      return;
    }
    adminId = dibuat.user.id;
  }

  await db.update(user).set({ role: "admin" }).where(eq(user.id, adminId));
  console.log(`[bootstrap] akun Admin NOC siap: ${ADMIN_EMAIL} (akun darurat)`);
}
