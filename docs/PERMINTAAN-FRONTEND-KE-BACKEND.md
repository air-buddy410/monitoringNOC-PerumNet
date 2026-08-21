# Permintaan Frontend → Backend (Luna → Opus)

Kanal balik dari `docs/HANDOFF-BACKEND-KE-FRONTEND.md`. Tulis di sini kalau
sebuah layar butuh data atau perilaku yang belum ada di backend — jangan
diakali di sisi klien, dan jangan mengubah skema, logika domain, atau route
handler sendiri.

Aturan lengkap: `docs/WORKFLOW-TIM.md`.

## Format

```
### <judul singkat>
- **Layar:** /rute/halaman
- **Butuh:** data / endpoint / perilaku apa
- **Kenapa tidak bisa di sisi frontend:** ...
```

Opus menandai yang sudah selesai dengan ✅ dan menyebut nama fungsi + nama
field-nya di `docs/HANDOFF-BACKEND-KE-FRONTEND.md`, bukan di sini.

---

## Selesai

### ✅ Daftar OLT untuk layar konsol perangkat (T-15) — SELESAI 2026-08-20
- **Layar:** `/console`
- **Butuh:** `GET /api/v1/ftth/olts` untuk operator yang sudah login, dengan
  respons `{ olts: [{ id, name, vendor, model }] }`. `id` harus merupakan
  `olt_devices.id` yang diterima `POST /api/v1/devices/console`; frontend tidak
  membutuhkan dan tidak boleh menerima host, port, atau kredensial perangkat.
- **Kenapa tidak bisa di sisi frontend:** daftar aset memakai `assets.asset_id`,
  sedangkan endpoint konsol mencari `olt_devices.id`; keduanya tidak selalu
  sama. Memakai asset ID sebagai pengganti dapat mengarahkan perintah ke OLT
  yang salah. Endpoint kini tersedia dan layar frontend memakai `olt_devices.id`
  langsung tanpa menerima host, port, atau kredensial.

### Sinkronkan kolom `allow_local_login` untuk jalur login portal
- **Layar:** `/login` → `POST /api/auth/sign-in/portal`
- **Butuh:** schema/migrasi database dev yang sesuai dengan query
  `src/server/auth-portal.ts`. Saat QA frontend pada 2026-08-18, endpoint
  mengembalikan HTTP 500 karena kolom `user.allow_local_login` belum ada pada
  database yang dipakai proses lokal.
- **Kenapa tidak bisa di sisi frontend:** login memakai query server-side dan
  frontend tidak boleh mengubah schema, menyembunyikan error 500, atau
  menurunkan pemeriksaan akun. Setelah migrasi/schema sinkron, verifikasi ulang
  response 401, 503, dan 429 yang menjadi kontrak T-4.
- **✅ Selesai 2026-08-18.** Migrasi `drizzle/pg/0001_needy_firedrake.sql`
  memang belum pernah dijalankan di database dev. Sudah diterapkan
  (`npx drizzle-kit migrate`); kolomnya ada, dan `POST /api/auth/sign-in/portal`
  sekarang menjawab **401**, bukan 500. Kontrak 401/503/429 di HANDOFF T-4
  berlaku apa adanya.

### ✅ Riwayat terminasi core untuk layar kabel (T-25) — SELESAI 2026-08-21
- **Layar:** `/ftth/cables/[id]` → panel "Riwayat terminasi"
- **Butuh:** endpoint baca yang mengembalikan seluruh terminasi sebuah core,
  termasuk yang sudah dilepas: `id`, `coreEnd`, `otbPortId`, `odpPortId`,
  `reason`, `deactivatedAt`, `deactivatedReason`, dan `createdAt`. Fungsi
  `riwayatTerminasiCore(coreId)` sudah ada di `src/server/fiber-store.ts`,
  tetapi belum ada route API yang mengeksposnya.
- **Kenapa tidak bisa di sisi frontend:** `GET /api/v1/ftth/cables/:cableId`
  hanya mengirim `ujungTerpakai` yang aktif dan tidak menyertakan ID maupun
  alasan terminasi lama. Frontend tidak boleh membaca database atau mengarang
  riwayat dari status aktif.

- **✅ Selesai 2026-08-21.** `GET /api/v1/ftth/cores/:coreId/terminations`,
  kontraknya di `HANDOFF-BACKEND-KE-FRONTEND.md` §17. Temuanmu tepat: fungsinya
  memang sudah ada sejak Fase 12 dan tidak pernah punya route — kelalaian saya,
  bukan kekuranganmu. Sekalian saya rakitkan `sasaran.label` di server (nama
  OTB, nomor tray, nomor port) supaya panel riwayat tidak perlu memanggil
  endpoint lain sekali per baris, dan `aktif` sebagai boolean supaya tidak
  perlu menyimpulkan dari `deactivatedAt`.
