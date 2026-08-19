# Operasional Portal NOC PerumNet (Fase 8)

Runbook, environment variables, contract integrasi, batasan discovery,
checklist go-live, dan prosedur rollback. Melengkapi
`docs/DEPLOYMENT_LIBRENMS.md` (infrastruktur) dan `docs/DB_MIGRATION.md`
(database).

## 1. Environment variables

| Variabel | Wajib | Keterangan |
|---|---|---|
| `DATABASE_URL` | produksi | `postgres://user:pass@host:5432/db` |
| `BETTER_AUTH_SECRET` | ya | string acak panjang |
| `BETTER_AUTH_URL` | ya | URL publik portal |
| `LIBRENMS_URL` | ya* | `https://nms.perumnet.id` — tanpa ini mode fixture |
| `LIBRENMS_TOKEN` | ya* | token API LibreNMS (read-only, server-side) |
| `LIBRENMS_WEBHOOK_SECRET` | produksi | header `x-webhook-token` dari LibreNMS |
| `NOTIFICATION_BOT_SECRET` | **wajib bila memakai bot** | header `x-bot-token` pada `POST /api/notifications/channels/verify`. Tanpa ini rute itu menjawab **503** — sengaja tertutup, bukan terbuka |
| `CUSTOMER_PORTAL_SECRET` | ya | HMAC deep-link portal customer |
| `CUSTOMER_SUPPORT_CONTACT` | opsional | kontak pada halaman status pelanggan |
| `OUTWARD_ACTIONS` | opsional | **bawaan `BLOCKED`.** `ALLOWED` hanya setelah cutover dari ALUS — lihat §9 |
| `CRM_WEBHOOK_URL` | opsional | notifikasi incident outbound ke CRM — **tidak berpengaruh selama `OUTWARD_ACTIONS=BLOCKED`** |
| `CRM_WEBHOOK_TOKEN` | opsional | Bearer token webhook CRM |
| `TELEGRAM_BOT_TOKEN` | opsional | notifikasi Telegram nyata (tanpa ini = simulasi) — **ditahan selama `BLOCKED`** |
| `WHATSAPP_API_URL` / `WHATSAPP_API_TOKEN` | opsional | gateway WhatsApp — **ditahan selama `BLOCKED`** |
| `REDIS_URL` | opsional | cache Redis; tanpa ini cache in-memory |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | opsional | bootstrap admin pertama |

\* Diperlukan untuk mode terhubung (source of truth LibreNMS). Tanpa keduanya
aplikasi berjalan dalam mode **fixture development berlabel** — jangan dipakai
operasional.

## 2. Contract integrasi CRM eksternal

**Mapping** (dibuat dari Portal, admin):

```
POST /api/v1/integrations/crm/service-mappings
{ "externalCustomerId": "...", "externalServiceId": "...", "assetId": "..." }
→ 201/200 { "mapping": { mappingId, syncStatus, ... } }
```

**Webhook outbound** (Portal → CRM, bila `CRM_WEBHOOK_URL` di-set):

```
POST <CRM_WEBHOOK_URL>
Authorization: Bearer <CRM_WEBHOOK_TOKEN>
{
  "idempotencyKey": "<incidentId>:<open|recovered>",   // cegah duplikat
  "type": "incident.open" | "incident.recovered",
  "externalCustomerId": "...", "externalServiceId": "...",
  "severity": "warning" | "critical",
  "message": "...",           // sudah di-sanitasi (tanpa hostname internal)
  "occurredAt": "ISO-8601"
}
```

Sifat: best-effort, retry 3× (500ms/1.5s), audit di `audit_logs`
(`crm_webhook.sent/failed`). Penerima wajib mencatat `idempotencyKey` dan
mengembalikan 2xx; respons non-2xx memicu retry.

**Portal customer** (deep link yang didistribusikan CRM/email):

```
/customer/status?customerId=<id>&serviceId=<id>&token=<HMAC>
```

`token = HMAC_SHA256(CUSTOMER_PORTAL_SECRET, "<customerId>|<serviceId>")`
(hex). Tanpa `CUSTOMER_PORTAL_SECRET` semua tautan ditolak. Response
`GET /api/v1/customer/services/:serviceId/status` **tidak pernah** memuat
hostname, IP manajemen, vendor/model, topologi, atau raw grafik.

## 3. Batasan discovery topologi

- Sumber: relasi perangkat & neighbor LLDP/CDP dari LibreNMS
  (`/devices/{id}/links`), **per device terpetakan**.
- Hasil selalu **rekomendasi** (`pending`) — tidak pernah menimpa node/link
  manual; versi operasional hanya berubah lewat Publish.
- Device tanpa pemetaan aset tidak menghasilkan usulan; link ke device tak
  dikenal tidak dihitung (`discovered`).
- Kegagalan HTTP per device tidak menggagalkan keseluruhan run
  (`failedDevices` dilaporkan).
- Deduplikasi usulan pending berbasis payload canonical; usulan yang sudah
  direview tidak diulang.
- Usulan node dibatasi pada aset terpetakan; jika discovery membutuhkan
  data FDB (MAC) untuk topologi akses, diperlukan polling FDB di LibreNMS
  dan sumber `fdb` ditambahkan pada rilis berikutnya.

## 4. Runbook NOC (ringkas)

| Situasi | Tindakan |
|---|---|
| Perangkat baru | Onboarding LibreNMS (lihat DEPLOYMENT_LIBRENMS.md §6), lalu impor aset portal |
| Aset tampil warning terus | Cek `GET /api/v1/integrations/librenms/status` (admin) — `reachable` & `mappedAssetCount`; cek token/izin |
| Alert duplikat | Webhook idempoten — verifikasi `incidents_active_alert_idx`; satu incident aktif per alert |
| Grafik RRD kosong | Perangkat belum terpetakan atau RRD belum terbentuk (proxy 404) |
| Portal customer 404 | Mapping belum dibuat atau aset tidak terpetakan |
| Notifikasi tidak terkirim | Tanpa `TELEGRAM_BOT_TOKEN`/`WHATSAPP_API_URL` berjalan simulasi (lihat `notification_deliveries`) |
| Postgres down | `docker compose -f docker-compose.dev.yml up -d`; produksi: jalankan ulang service + healthcheck |

## 5. Checklist go-live

- [ ] Semua env production terisi (lihat §1), `.env*` tidak di-commit
- [ ] `npm run build && npm start` bersih; `GET /api/v1/integrations/librenms/status` → `reachable: true`
- [ ] Aset terpetakan (`mappedAssetCount == deviceCount` yang diinginkan)
- [ ] Webhook LibreNMS teruji: alert → incident tunggal; recovery → resolved; CRM/webhook notifikasi masuk
- [ ] Portal customer: 3 layanan contoh OK (up/degraded/down), token salah → 401
- [ ] Backup LibreNMS teruji restore (lihat DEPLOYMENT_LIBRENMS.md §7)
- [ ] QA desktop/tablet/mobile: dashboard, perangkat, detail, peta, topologi, notifikasi, laporan, profile, users, portal customer
- [ ] Rate limit & audit: webhook, acknowledge, mapping tercatat di `audit_logs`

## 6. Rollback

1. **Kode**: deploy commit/tag sebelumnya, `npm run build && npm start`.
2. **Database**: `pg_dump` sebelum setiap migrasi; rollback = restore dump +
   checkout kode yang sesuai (lihat `docs/DB_MIGRATION.md`).
3. **LibreNMS**: restore backup (lihat DEPLOYMENT_LIBRENMS.md §7).
4. **Mode fixture**: hapus `LIBRENMS_URL`/`LIBRENMS_TOKEN` → aplikasi kembali
   berlabel fixture development (bukan operasional).
5. **Webhook**: matikan transport API di LibreNMS / hapus secret — Portal
   tetap polling status via API.
6. **Semua aksi keluar sekaligus**: setel `OUTWARD_ACTIONS=BLOCKED` lalu
   restart. Satu variabel menutup ketiga transport (CRM, Telegram, WhatsApp) —
   lebih cepat dan lebih sulit salah daripada mencabut tiga URL satu per satu.
   Ini kill switch tercepat kalau portal ternyata mengirim sesuatu yang tidak
   diharapkan.

## 7. Item yang belum dapat divalidasi tanpa infrastruktur nyata

- Integrasi penuh dengan device SNMP nyata (LibreNMS saat ini 0 perangkat —
  impor aset & discovery topologi teruji dengan mock/test unit).
- Pengiriman Telegram/WhatsApp nyata (teruji mode simulasi). **Memang
  disengaja**: `OUTWARD_ACTIONS=BLOCKED` menahannya. Validasi nyata
  ditunda sampai cutover, terhadap target staging yang ditentukan lebih dulu.
- Webhook ingress dari LibreNMS nyata (teruji HTTP langsung + unit test).
- CRM nyata (contract + adapter diuji dengan stub).

## 8. Menyalakan login satu pintu (mailcow)

Sumber kebenaran password ditentukan `AUTH_PROVIDER`. Bawaannya `LOCAL` —
**tidak ada yang berubah sampai variabel ini diubah.**

| Nilai | Password yang berlaku | Endpoint yang mati |
|---|---|---|
| `LOCAL` (bawaan) | hash Better Auth | `/sign-up/email` (ditutup permanen) |
| `MAILSERVER` | password EMAIL di mailcow, lewat IMAPS 993 | `/sign-in/email`, `/sign-up/email`, `/change-password` |

Kedua mode masuk lewat alamat yang sama: `POST /api/auth/sign-in/portal`.

### Urutan menyalakan — jangan dibalik

1. **Migrasi database** (`drizzle/pg/0001_*.sql`) — menambah kolom
   `user.allow_local_login`. Aman dijalankan kapan saja: default `false`,
   tidak mengubah baris yang ada.
2. **Samakan alamat email.** Login mencocokkan lewat email. Alamat di tabel
   `user` harus sama persis dengan alamat mailbox di mailcow. Yang tidak cocok
   tidak bisa masuk, dan gejalanya membingungkan: mailcow menerima
   passwordnya, tapi portal tidak mengenali orangnya.
3. **Pastikan ada akun darurat.** Minimal satu baris dengan
   `allow_local_login = true` DAN punya password lokal. Bootstrap
   (`ADMIN_EMAIL`) membuatnya otomatis sebagai akun darurat. Periksa:
   ```sql
   SELECT email FROM "user" WHERE allow_local_login = true;
   ```
   Tanpa ini, mailserver yang mati berarti **tidak ada seorang pun** bisa
   masuk — termasuk untuk memperbaikinya.
4. **Frontend sudah pindah ke `/sign-in/portal`** (tugas T-4 di
   `HANDOFF-BACKEND-KE-FRONTEND.md`). Sebelum ini selesai, menyalakan mode
   mailserver akan mematikan form login yang masih menembak `/sign-in/email`.
5. Baru set:
   ```
   AUTH_PROVIDER=MAILSERVER
   MAILSERVER_URL=https://mail.perumnet.id
   ```
   lalu restart. Uji dengan satu akun biasa **dan** akun darurat.

### Rollback

Kembalikan `AUTH_PROVIDER=LOCAL` dan restart. Kolom `allow_local_login` boleh
ditinggal — ia tidak berpengaruh di mode LOCAL. Akun yang dibuat selama mode
MAILSERVER **tidak punya password lokal**, jadi setelah rollback mereka perlu
dibuatkan password oleh admin.

### Yang tidak dijaga di sini

- Pembatas percobaan login (5 per menit per IP) disimpan **di memori proses**.
  Kalau nanti berjalan lebih dari satu instance, hitungannya terpisah per
  proses — sama seperti catatan rate limit webhook LibreNMS di §3.
- Portal tidak pernah menyimpan password email, juga tidak mencatatnya di log
  maupun audit. Yang tercatat di `audit_logs` hanya berhasil/gagal, alasannya,
  dan jalur yang dipakai (`mailserver` atau `lokal-darurat`).

## 9. Mode baca-saja (aksi keluar)

Portal tidak mengirim notifikasi dan tidak mendorong data ke sistem lain selama
`OUTWARD_ACTIONS` bukan `ALLOWED` — dan **bawaannya bukan**. Aturan lengkap,
alasannya, dan daftar apa yang TIDAK dijamin ada di
[`docs/MODE-BACA-SAJA.md`](MODE-BACA-SAJA.md).

Periksa keadaannya: `GET /api/read-only-mode` (cukup login).

**Jangan memeriksanya lewat `/proc/<pid>/environ` — di situ ia TIDAK akan
terlihat, dan itu normal.** PM2 menjalankan `next start` dari cwd
`~/apps/noc-portal`, dan Next memuat `.env.production` sendiri saat runtime;
`environ` hanya memuat lingkungan saat exec. Diperiksa 19 Agustus 2026: **tidak
satu pun** variabel aplikasi ada di sana — termasuk `DATABASE_URL`, padahal
databasenya jelas terhubung.

Dibuktikan dengan kontras, bukan dugaan: satu alert uji ke lubang hitam
(`127.0.0.1:9`) menghasilkan baris `outward.blocked` saat `BLOCKED`, dan **tidak
menghasilkannya** saat `ALLOWED`. Satu-satunya yang berbeda adalah variabelnya.

**Kerapuhan yang harus diingat:** mekanisme ini bergantung pada
`.env.production` berada di cwd proses. Kalau noc-portal kelak dipindah ke
`output: 'standalone'` atau ke tata letak direktori rilis seperti enterprise
(`~/releases/<commit>/`) tanpa `.env.production` di sebelahnya, **variabelnya
berhenti terbaca — dan berhentinya diam-diam.** Penjaga akan jatuh ke bawaan
`BLOCKED`, jadi tidak berbahaya; yang rusak adalah kemampuan menyalakannya
nanti. CRM tidak punya masalah ini karena `.env` sengaja dibuang dari citra
lewat `.dockerignore`, sehingga Compose wajib meneruskannya secara eksplisit.

**Kalau notifikasi/CRM tidak terkirim padahal sudah dikonfigurasi**, itu
kemungkinan besar bukan gangguan — cek endpoint di atas lebih dulu. `BLOCKED`
adalah keadaan yang BENAR sampai ALUS berhenti melakukan hal yang sama.

Bedanya di `audit_logs`: `crm_webhook.failed` = dicoba lalu gagal (perlu
ditindaklanjuti); `outward.blocked` = tidak pernah dicoba (tidak perlu).

## 10. Cadangan database

**Sampai 19 Agustus 2026 tidak ada cadangan sama sekali** — tidak ada baris
cron, tidak ada foldernya. Ditemukan saat memverifikasi temuan serupa di CRM.

Sekarang: `~/deploy/noc-portal/cadangkan-database.sh`, jalan **03:30 WITA** tiap
hari lewat cron (sengaja jauh dari enterprise 18:30 dan warehouse 02:30),
tersimpan di `~/backups/noc-portal/`, disimpan **14 hari**. Sumber kebenaran
skripnya ada di repo: `deploy/cadangkan-database.sh` — kalau diubah, salin
ulang ke VPS.

Memulihkan:

```bash
gunzip -c <berkas>.sql.gz | docker exec -i perumnet-noc-postgres \
  psql -U perumnet_noc -d perumnet_noc
```

### Kenapa skripnya rewel soal verifikasi

Perintah cadangan CRM di dokumennya menyebut nama database yang salah selama
berbulan-bulan. Yang membuatnya bertahan bukan kesalahannya, melainkan cara ia
gagal: `pg_dump` mati, `gzip` di sisi kanan pipa tetap sukses, berkasnya lahir
dengan nama dan tanggal yang benar, dan `gzip -t` menyatakannya utuh — 30 bita,
nol baris.

Tiga penangkal dipakai di sini, dan **ketiganya diuji dengan sengaja
menggagalkan skripnya**, bukan cuma dijalankan pada jalur normal:

1. `set -o pipefail` — tanpa itu status pipa diambil dari perintah terakhir.
2. Hitung blok `COPY` sesudahnya; berkas kosong tetap "utuh" menurut gzip.
3. Tulis ke `.part` dulu, beri nama akhir **setelah** isinya terbukti. Versi
   pertama skrip ini menulis langsung ke nama akhir — dan uji jalur-gagal
   menangkapnya meninggalkan `.sql.gz` kosong bertanggal hari ini, yang bagi
   siapa pun yang melihat folder tampak seperti cadangan yang berhasil.

Pemangkasan cadangan lama juga hanya dijalankan **setelah** cadangan hari ini
terbukti berisi — supaya yang lama tidak pernah dihapus demi yang kosong.

### Diuji sampai pulih, bukan sampai jadi berkas

19 Agustus 2026: cadangan dipulihkan ke database terpisah (`uji_pulih`) di
container yang sama. 19 tabel, `user` 3, `assets` 15, `notification_channels` 2,
`sla_reports` 4 — semuanya cocok dengan aslinya, nol galat. Database ujinya
dihapus setelahnya. **Cadangan yang belum pernah dipulihkan belum tentu
cadangan.**
