// Mendaftarkan akun portal dari sebuah daftar di LUAR repo.
//
// Repo ini PUBLIK. Nama dan alamat email pegawai tidak boleh masuk ke
// dalamnya — jadi skrip ini tidak memuat daftar apa pun, ia hanya membacanya
// dari berkas yang jalurnya diberikan saat dijalankan. Berkas yang berada di
// dalam repo DITOLAK, supaya daftar itu tidak pernah tidak sengaja ikut
// ter-commit.
//
// Jalur pembuatan akunnya SAMA dengan `POST /api/users` (`createPortalUser`),
// bukan salinan yang mirip. Skrip yang punya jalurnya sendiri akan pelan-pelan
// berbeda dari aplikasinya — dan bedanya baru ketahuan saat ada orang yang
// tidak bisa masuk.
//
// Pakai:
//   NODE_ENV=production npx tsx scripts/seed-akun-tim.ts --dari ~/akun-noc.tsv
//   NODE_ENV=production npx tsx scripts/seed-akun-tim.ts --dari ~/akun-noc.tsv --terapkan
//
// Tanpa `--terapkan` ia hanya melaporkan apa yang AKAN terjadi.
//
// Bentuk berkas (TSV, satu akun per baris, `#` = komentar):
//   email <TAB> nama <TAB> peran [<TAB> darurat]
//   peran: admin | noc | engineer | manajemen
//   kolom keempat "darurat" menandai akun yang boleh masuk dengan password
//   lokal saat mailserver mati.

import { readFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { diDalamRepo, uraikanDaftar } from "./seed-akun-tim-lib";

// WAJIB sebelum apa pun yang menyentuh database — skrip ini bukan Next.js,
// jadi `.env.production` tidak dimuat sendiri. Tanpa DATABASE_URL, `src/db`
// diam-diam jatuh ke PGlite dan akun dibuat di database yang salah tanpa
// satu pun galat. Alasan yang sama dengan scripts/worker.ts.
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

if (!process.env.DATABASE_URL?.trim()) {
  console.error(
    "[seed] DATABASE_URL kosong setelah memuat .env — akun akan dibuat di " +
      "PGlite, BUKAN database aplikasi. Berhenti.",
  );
  process.exit(1);
}

function argValue(nama: string): string | null {
  const i = process.argv.indexOf(`--${nama}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main() {
  const dari = argValue("dari");
  const terapkan = process.argv.includes("--terapkan");
  if (!dari) {
    console.error("Pakai: --dari <berkas.tsv> [--terapkan]");
    process.exit(1);
  }

  const jalur = path.resolve(dari.replace(/^~(?=\/)/, process.env.HOME ?? "~"));
  const repo = path.resolve(process.cwd());
  if (diDalamRepo(jalur, repo)) {
    console.error(
      `[seed] ${jalur} ada DI DALAM repo. Repo ini publik — daftar nama dan ` +
        "email pegawai harus disimpan di luar. Berhenti.",
    );
    process.exit(1);
  }

  const daftar = uraikanDaftar(readFileSync(jalur, "utf8"));
  console.log(`[seed] ${daftar.length} akun dibaca dari ${jalur}`);

  // Diimpor SETELAH env dimuat — modul db membaca DATABASE_URL saat diimpor.
  const { createPortalUser } = await import("@/server/user-provisioning");
  const { authProviderMode } = await import("@/server/mail-auth");
  console.log(`[seed] AUTH_PROVIDER aktif: ${authProviderMode()}`);

  if (!terapkan) {
    for (const b of daftar) {
      console.log(`  akan dibuat: ${b.email} (${b.peran})${b.darurat ? " [darurat]" : ""}`);
    }
    console.log("[seed] uji coba saja — tambahkan --terapkan untuk benar-benar membuat.");
    return;
  }

  let dibuat = 0;
  let dilewati = 0;
  for (const b of daftar) {
    // Akun darurat butuh password lokal; skrip ini sengaja TIDAK bisa
    // membuatnya. Password darurat disetel orang, bukan skrip — kalau skrip
    // yang menentukannya, ia harus menyimpannya di suatu tempat.
    if (b.darurat) {
      console.log(`  - ${b.email}: dilewati, akun darurat disetel manual.`);
      dilewati += 1;
      continue;
    }
    const hasil = await createPortalUser({
      name: b.nama,
      email: b.email,
      role: b.peran,
    });
    if (hasil.ok) {
      console.log(`  + ${b.email} (${b.peran})`);
      dibuat += 1;
    } else {
      console.log(`  - ${b.email}: ${hasil.error}`);
      dilewati += 1;
    }
  }
  console.log(`[seed] selesai — ${dibuat} dibuat, ${dilewati} dilewati.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[seed]", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
