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

## Terbuka

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

---

## Selesai

_(kosong)_
