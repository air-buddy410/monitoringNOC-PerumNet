# Aturan kerja tim — Monitoring NOC PerumNet

**Berlaku sejak:** 2026-08-13. Aturan yang sama dipasang di semua aplikasi
PerumNet (lihat §6), supaya pindah aplikasi tidak berarti pindah kebiasaan.
Sumber aslinya: `../crm/docs/WORKFLOW-TIM.md`.

---

## 1. Pembagian peran

| | **Luna** (Codex) | **Opus** (Claude Code) |
|---|---|---|
| Tanggung jawab | **FRONTEND** | **BACKEND · SERVER · DATABASE** |
| Yang dikerjakan | Halaman & komponen, design system, tata letak, responsif, aksesibilitas, teks antarmuka, state di sisi klien | Skema database & migrasi, logika domain, API, autentikasi & hak akses, collector/worker, integrasi luar, deploy |
| Berkas khas di repo ini | `src/app/**` (tampilan), `src/components/**`, `src/hooks/**`, CSS/tema | `src/db/**` + `drizzle/**`, `src/server/**`, `src/lib/**`, `src/app/api/**`, `src/proxy.ts`, `scripts/**`, `tests/**` |

Satu aturan yang menyelesaikan sebagian besar tabrakan: **yang menulis ke
database adalah Opus, yang menulis ke mata pengguna adalah Luna.**

## 2. Batas yang tidak boleh dilanggar

**Opus tidak mengubah berkas presentasi.** Tidak menata ulang komponen atau
tema milik Luna. Kalau sebuah fase butuh perubahan tampilan, tulis
permintaannya di §5 — jangan kerjakan sendiri. Halaman baru boleh dibuat
Opus, tapi **hanya memakai komponen dan token gaya yang sudah ada**.

**Luna tidak mengubah aturan domain.** Tidak menyentuh `src/db/schema*`,
migrasi `drizzle/**`, `src/server/**`, atau route handler di `src/app/api/**`.
Kalau sebuah layar butuh data yang belum ada, tulis permintaannya di §5.
Validasi di form itu kenyamanan; **penegakannya tetap di sisi server**.

Khusus aplikasi ini: **status perangkat, insiden, dan hasil polling hanya
boleh ditulis oleh collector/worker.** Halaman monitor tidak pernah menulis
ke tabel itu — kalau UI butuh mengubah keadaan, lewat API yang mencatat siapa
dan kapan, bukan tulis langsung.

## 3. Alur per fase (urutan yang sudah terbukti)

1. Baca dokumen desain/PRD fase itu — jangan mulai dari tebakan.
2. Buat branch sendiri.
3. Skema **ditambah**, bukan diubah; buat migrasi Drizzle, jangan edit migrasi lama.
4. Terapkan migrasi ke database dev, pastikan naik bersih dari nol juga.
5. Logika domain di `src/server/**` atau `src/lib/**`, bukan di komponen.
6. Route/API tipis, hak akses diperiksa di server.
7. Halaman UI memakai komponen yang ada; entri nav **ditambahkan**, tidak menata ulang.
8. `npm run typecheck` + `npm run build`.
9. `npm test` — kasus positif **dan** negatif.
10. Smoke di browser, termasuk **viewport 375 px**.
11. Perbarui README/dokumen, lalu commit + PR.

## 4. Aturan yang mahal kalau dilanggar

Lahir dari kesalahan yang benar-benar terjadi di proyek PerumNet, bukan teori.

- **Aturan domain ditegakkan di server, bukan UI.** Yang ditegakkan di UI bisa dilewati lewat request langsung.
- **Kegagalan polling adalah keadaan yang terlihat, bukan log yang tenggelam.** Simpan status + pesan errornya supaya bisa dilihat dari halaman, jangan cuma `console.error`.
- **Sebelum percaya sebuah tes, jalankan juga terhadap kode SEBELUM perbaikan.** Tes yang "lolos" di kedua sisi berarti tidak menguji apa pun.
- **JANGAN PERNAH `git reset --hard` di direktori kerja bersama.** Pada 2026-08-12 perintah itu menghapus 13 berkas yang belum di-stage di repo CRM; tidak ada yang bisa dipulihkan. Pakai `git reset --soft` atau `git cherry-pick`.
- **Stage per-berkas, jangan `git add -A`.**
- **Jangan pakai `--delete-branch` saat merge PR.** Merge di remote, lalu `git checkout` + `git pull --ff-only`.
- **Jangan pernah membaca atau mencetak isi `.env`.** Kredensial disimpan sebagai *nama environment variable*, bukan nilainya.

## 5. Papan permintaan antar-peran

Tulis permintaan di sini, jangan kerjakan wilayah orang lain.

- **Opus → Luna:** `docs/HANDOFF-BACKEND-KE-FRONTEND.md`
- **Luna → Opus:** `docs/PERMINTAAN-FRONTEND-KE-BACKEND.md`

Format: **layar mana**, **butuh apa**, **kenapa tidak bisa diakali di sisi sendiri**.

## 6. Peta aplikasi PerumNet

| App | Folder | Stack | Database |
|---|---|---|---|
| CRM | `APP-Perumnet/crm` | Next.js 15 + Prisma | PostgreSQL (Docker `perumnet-postgres`, port 5433) |
| **Monitoring NOC** (ini) | `APP-Perumnet/monitoring-noc` | Next.js + Drizzle + better-auth | pglite / SQLite |
| Enterprise | `APP-Perumnet/enterprise` | Next.js + Drizzle | libsql |
| Captive Portal | `APP-Perumnet/captive-portal` | Node (`server.mjs`) | berkas di `data/` |
| ~~PRTG PerumNet~~ | `APP-Perumnet/_arsip/prtg-lama` | — | **usang** |

**Repo ini adalah kelanjutan resmi dari `PRTG PerumNet`.** Commit HEAD PRTG
(`83e1668`, Phase 3) ada di dalam riwayat repo ini, yang lanjut sampai Phase 8.
Kalau ada yang menyebut "PRTG", yang dimaksud hampir pasti repo ini. Di folder
PRTG lama masih ada 8 berkas UI yang belum di-commit dan belum pernah masuk git
mana pun — jangan dihapus sebelum diputuskan.

Kelima folder di atas **sudah dipindahkan** ke dalam folder payung
`~/Dev Project/APP-Perumnet/` pada 2026-08-13. Tiap app tetap repo, database,
dan deploy sendiri — tidak ada monorepo, tidak ada paket bersama.
