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
| `LIBRENMS_URL` | ya* | **`http://127.0.0.1:8000`** — instans LOKAL. Lihat §11 sebelum menggantinya ke hostname publik |
| `LIBRENMS_TOKEN` | ya* | token API LibreNMS (read-only, server-side) |
| `LIBRENMS_WEBHOOK_SECRET` | produksi | header `x-webhook-token` dari LibreNMS |
| `LOGIN_DEFAULT_DOMAIN` | opsional | domain yang dilengkapi saat orang mengetik **username saja** di layar login (§8.1). Kosong = harus alamat lengkap |
| `CRM_DATABASE_URL` | hanya saat impor | koneksi BACA-SAJA ke database CRM untuk `npm run impor:crm` (§12) |
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

### HIDUP sejak 20 Agustus 2026

`AUTH_PROVIDER=MAILSERVER` + `MAILSERVER_URL=https://mail.perumnet.id`.
Cadangan env sebelum perubahan: `~/.env.production.noc.sebelum-mailcow-20260820`.

Yang menahannya sampai pagi itu adalah alamat email: NOC hanya punya tiga akun
dan dua di antaranya beralamat `@perumnet.co.id` — **domain tanpa MX maupun A
record**, jadi mailbox-nya tidak mungkin ada.

```
$ dig +short MX perumnet.id      → 5 mail.perumnet.id.
$ dig +short MX perumnet.co.id   → (kosong)
```

Diselesaikan dengan mendaftarkan 5 akun beralamat mailbox sungguhan lewat
`npm run seed:akun -- --dari <berkas di luar repo> --terapkan`. Daftar akunnya
**tidak ada di repo ini** (repo publik); skripnya menolak berkas daftar yang
berada di dalam repo.

**Bukti jalur mailcow benar-benar dipakai** — bukan sekadar 401 yang bisa
datang dari mana saja. `audit_logs` membedakan cabangnya:

| Percobaan | HTTP | `alasan` di audit |
|---|---|---|
| akun tim, password salah | 401 | **`ditolak mailserver`** |
| akun darurat, password salah | 401 | `password lokal salah` |
| alamat tanpa akun portal | 401 | `akun tidak ditemukan` |

Baris pertama itu yang penting: kalau ada jalan mundur diam-diam ke hash
lokal, ia akan berbunyi `password lokal salah` seperti baris kedua.

**Dua akun `@perumnet.co.id` sengaja ditinggal.** Keduanya kini tidak bisa
masuk (bukan mailbox, dan `allow_local_login = false`). Tidak dihapus supaya
jejaknya di `audit_logs` tidak putus. Menghapusnya kapan saja aman; ia tidak
mengubah siapa yang bisa masuk.

**`noc@perumnet.id` mailbox-nya dibuat 20 Agustus** atas permintaan pemilik —
sebelumnya alamat itu tidak ada di mailcow, baik sebagai mailbox maupun alias
(dicek lewat API, saat itu 34 mailbox). Akun portalnya lalu didaftarkan dengan
peran `noc`. Jadi total **7 akun** beralamat `@perumnet.id`.

### Login berhasil — dibuktikan, bukan diperkirakan

Karena sandi awal `noc@perumnet.id` memang baru dibuat, jalur lengkapnya bisa
diuji tanpa memakai sandi siapa pun:

```
POST /api/auth/sign-in/portal  {"email":"noc@perumnet.id","password":<sandi email>}
  → 200
audit_logs: login.berhasil | {"mode":"MAILSERVER","jalur":"mailserver"}
```

`jalur: mailserver` itu yang menutup pertanyaannya — password diperiksa ke
mailcow lewat IMAPS, bukan ke hash lokal (akun ini memang tidak punya hash).

Sesi yang sama dipakai untuk membuktikan §13.1 di produksi: 6 OLT,
`konsolSiap: true` semuanya, `siteName` terisi, `credentialRef` tidak ikut
terkirim.

### Yang masih belum diuji

Cabang **mailserver tak terjawab** (503). Mengujinya berarti mematikan
`MAILSERVER_URL` sementara. Cabang itu punya uji unit
(`tests/mail-auth.test.ts`, `tests/auth-portal.test.ts`). Kalau suatu saat
ingin dibuktikan langsung: kosongkan `MAILSERVER_URL`, restart, akun tim harus
menjawab **503** dan akun darurat tetap **401**.

### Kotak surat bersama melemahkan audit

`noc@perumnet.id` dan `it@perumnet.id` adalah kotak surat **bersama**, bukan
orang. Keduanya berperan `noc`/`admin`, jadi keduanya boleh membuka konsol
perangkat (§13) — dan setiap perintah akan tercatat di `audit_logs` sebagai
satu nama yang sama, siapa pun yang mengetiknya. Pada endpoint yang paling
berisiko di aplikasi ini, itu berarti jejaknya tidak bisa menunjuk siapa pun.

Belum diubah karena peran itu yang diminta pemilik. Kalau kelak jejak per orang
lebih penting daripada kemudahan akun bersama, turunkan keduanya ke `engineer`
dan biarkan orang memakai alamat pribadinya untuk konsol.

### 8.1. Masuk dengan username saja

`LOGIN_DEFAULT_DOMAIN=perumnet.id` membuat orang bisa mengetik
`budi_prabhawa` alih-alih `budi_prabhawa@perumnet.id`. Yang memuat `@` tidak
disentuh sama sekali — jalur lama tetap persis seperti sebelumnya.

Kosong = fitur mati. Nilai yang tidak berbentuk domain juga dianggap kosong,
sama seperti `AUTH_PROVIDER` dan `OUTWARD_ACTIONS`: salah ketik jatuh ke sisi
yang tidak mengubah perilaku.

**Kenapa domain bawaan, bukan mencocokkan bagian depan alamat tersimpan.**
Mencocokkan `split_part(email,'@',1)` terlihat lebih pintar dan justru
berbahaya di sini: portal memuat `admin@perumnet.id` **dan**
`admin@perumnet.co.id`. Mengetik `admin` jadi ambigu, dan pemenangnya
ditentukan urutan baris — pada akun darurat, tepat ketika keadaan sedang
buruk. Dengan domain bawaan, `admin` selalu berarti akun yang sama.

Yang tercatat di `audit_logs` selalu alamat **lengkapnya**, bukan yang
diketik. Kalau yang tercatat `budi`, dua orang berbeda domain jadi tak
terbedakan di jejak audit.

Username yang tidak masuk akal (ada spasi, garis miring, `@` menggantung)
tidak disambung — ia berhenti di "akun tidak ditemukan", jalur yang sudah ada.

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

## 11. LibreNMS: pakai instans LOKAL, bukan nms.perumnet.id

**Diperbaiki 19 Agustus 2026.** Sebelumnya `LIBRENMS_URL=https://nms.perumnet.id`
dengan token yang **tidak terdaftar** di instans lokal. Akibatnya API menjawab
`{"status":"ok","count":0}` — jawaban yang SAH dan tampak sehat — sementara
LibreNMS lokal sedang memantau 6 perangkat dan 819 port dengan baik.

Portal terlihat "belum ada data" selama itu, dan tidak ada satu galat pun.

**Cara memastikan sambungannya benar:**

```bash
# berapa perangkat yang SEBENARNYA dipantau
docker exec -u librenms librenms-librenms-1   php artisan tinker --execute="echo \App\Models\Device::count();"

# berapa yang TERLIHAT oleh portal
set -a; . .env.production; set +a
curl -s -H "X-Auth-Token: $LIBRENMS_TOKEN" "$LIBRENMS_URL/api/v0/devices"   | python3 -c 'import json,sys; print(json.load(sys.stdin)["count"])'
```

Kedua angka harus sama. Kalau yang pertama > 0 dan yang kedua 0, masalahnya
**token atau alamat**, bukan perangkatnya — jangan mencari-cari di kode portal.

`php artisan` menolak jalan sebagai root; pakai `-u librenms`. Token diterbitkan
dengan menyisipkan baris ke tabel `api_tokens` (`user_id`, `token_hash`,
`description`, `disabled=0`).

## 11.4b. Konsol OLT: perintah apa yang benar-benar ada

Diuji langsung ke perangkat 22 Agustus 2026. **Kedua vendor sangat berbeda,
dan salah satunya tidak bisa apa-apa soal ONU.**

### ZTE (C300 / C600) — 3 perangkat

`show gpon onu state` bekerja dan mengembalikan tabel yang bisa diurai:

```
OnuIndex   Admin State  OMCC State  Phase State  Channel
--------------------------------------------------------------
1/2/1:1     enable       enable      working      1(GPON)
1/2/3:7     enable       disable     LOS          1(GPON)
```

Ukurannya nyata: ZTE-C300-102-Pesagi menjawab **377 baris / 21.589 karakter**
dalam satu perintah. Itu sebabnya layar konsol terasa membanjir.

Dua hal yang harus diingat penguraiannya:

- **Sisa `--More--`.** Penanda halamannya sudah dibuang `TANDA_MORE`, tapi
  spasi perata yang dikirim perangkat untuk menghapusnya tetap tertinggal —
  sebagian baris jadi berawalan spasi. Pangkas tiap baris sebelum diurai.
- `Phase State` bernilai `working` atau `LOS`; `LOS` berarti ONU-nya kehilangan
  sinyal, dan itu yang dicari orang saat membuka layar ini.

### HSGQ-G008 — 3 perangkat

**Tidak punya daftar ONU di vty sama sekali.** Ditanyakan langsung ke
perangkatnya:

```
OLT> show ?
  history  Display the session command history
  version  System Version infomation.

OLT> enable
OLT# show ?
  history         Display the session command history
  memory          Memory statistics
  startup-config  Contentes of startup configuration
  version         System Version infomation.
```

Empat perintah, dan tidak satu pun soal ONU — baik di mode biasa maupun
sesudah `enable`.

**Jangan ulangi diagnosis lama yang keliru.** Sampai 22 Agustus 2026
`src/server/olt-cli.ts` mencatat bahwa `show gpon onu detail-info` gagal
karena spasinya hilang di saluran telnet, jadi "perintahnya benar, salurannya
yang belum siap". Itu salah: `show version` sampai dengan spasi utuh di
perangkat yang sama. Spasi yang hilang itu ulah pelengkap-otomatis perangkat
saat bertemu token asing — gejala, bukan sebab. Perintahnya memang tidak ada.

Kalau daftar ONU HSGQ kelak dibutuhkan, jalannya bukan vty ini.

## 11.5b. Riwayat CPU, RAM, dan suhu

Dua tugas berjadwal di `src/server/device-metrics-poll.ts`:

| Kode | Tiap | Kerja |
|---|---|---|
| `metrics.poll` | **5 menit** (kolom `scheduled_tasks.interval_sec`) | mencuplik CPU, RAM, dan suhu tiap aset yang punya `librenms_device_id`, ke `device_metric_samples` |
| `metrics.prune` | 24 jam | membuang cuplikan > 30 hari |

**Kenapa ada.** Portal ini menampilkan grafik riwayat perangkat sejak awal,
tapi tidak pernah menyimpan riwayatnya — tabel telemetry era SQLite
dipensiunkan pada Fase 2 dan tidak pernah diganti. Sampai 22 Agustus 2026
grafiknya diisi `generateHistorySeries()`: bentuknya meyakinkan, angkanya
tidak pernah diukur. LibreNMS memuat nilai SEKARANG, bukan deretnya; kalau
tidak dicuplik, ia hilang.

**Kenapa 5 menit, bukan 30 detik seperti trafik.** CPU, RAM, dan suhu berubah
jauh lebih lambat daripada counter interface. Pada 5 menit, jendela 24 jam
berisi ~288 cuplikan untuk 96 titik grafik — sudah lebih rapat daripada yang
bisa dibaca orang. Lebih rapat dari itu hanya menambah baris.

**Yang TIDAK dicuplik, dan itu benar:**

- Aset tanpa `librenms_device_id` — mis. `HSGQ-100-Kecicang`, yang memang
  tidak mendukung SNMP dan dibaca lewat konsol CLI. Dihitung sebagai
  `dilewati`, bukan kegagalan.
- Perangkat yang ketiga metriknya tidak terbaca. Baris yang seluruhnya `NULL`
  tidak menambah satu pun fakta.

**Metrik yang tidak terbaca disimpan `NULL`, bukan `0`.** Ini bukan detail
gaya. Garis datar 0% terbaca sebagai "perangkat ini hemat"; yang sebenarnya
terjadi adalah sensornya tidak menjawab. Aturan yang sama berlaku pada jeda
trafik dan `averageUptime` di laporan SLA. Perangkat yang MEMANG menganggur
tetap melaporkan `0` — dan itu tersimpan sebagai `0`.

**Bentuk API LibreNMS yang mudah salah dibaca** — ini yang membuat CPU, RAM,
dan suhu tidak pernah terbaca sejak LibreNMS tersambung sampai 22 Agustus
2026:

| Endpoint | Isinya |
|---|---|
| `/devices/{id}/health` | **katalog nama kelas** — `[{desc: "Temperature", name: "device_temperature"}]`. Bukan sensor. Tidak ada `sensor_class` maupun `sensor_current`. |
| `/devices/{id}/health/{kelas}` | daftar `sensor_id` saja |
| `/devices/{id}/health/{kelas}/{sensor_id}` | barisnya yang sesungguhnya |

Dan baris terakhir itu **tidak memakai nama field yang sama untuk semua
kelas**, karena LibreNMS menyimpannya di tabel yang berbeda:

| Kelas | Field nilainya |
|---|---|
| `device_processor` | `processor_usage` |
| `device_mempool` | `mempool_perc` |
| `device_temperature`, `device_dbm` | `sensor_current` |

Kode lama membaca `sensor_current` untuk keempatnya, dan memperlakukan hasil
`/health` sebagai daftar sensor. Dua-duanya menghasilkan `null` tanpa galat —
grafik CPU/RAM kosong (terlihat seperti "belum ada data") dan kartu suhu
menampilkan **0 °C berlencana hijau "Normal"** untuk setiap perangkat.
Tesnya pun ikut lolos, karena ia menstub payload yang tidak pernah dikirim
server sungguhan.

Kalau kelak menambah kelas health baru, **ambil payload aslinya dulu** dari
server produksi sebelum menulis pembacanya.

**Kalau grafik kosong padahal perangkatnya hidup**, urutan periksanya:

```
# 1. Tugasnya terdaftar dan jalan?
docker exec perumnet-postgres psql -U perumnet -d perumnet -c \
  "select code, interval_sec, last_run_at, last_status, run_count, fail_count
     from scheduled_tasks where code like 'metrics.%';"

# 2. Ada cuplikannya?
docker exec perumnet-postgres psql -U perumnet -d perumnet -c \
  "select asset_id, count(*), max(sampled_at)
     from device_metric_samples group by 1 order by 2 desc limit 10;"

# 3. Kalau kosong semua: asetnya punya librenms_device_id?
docker exec perumnet-postgres psql -U perumnet -d perumnet -c \
  "select asset_id, hostname, librenms_device_id from assets order by 1;"
```

Perangkat yang baru didaftarkan wajar kosong selama 5–10 menit pertama.

## 11.6. Trafik: pengambilan, privasi, dan batas presisi

Tiga tugas berjadwal di `src/server/traffic.ts`:

| Kode | Tiap | Kerja |
|---|---|---|
| `traffic.poll` | **30 detik** (kolom `scheduled_tasks.interval_sec`, bisa diubah tanpa deploy) | menanyakan counter tiap interface yang dipantau |
| `traffic.discover` | 1 jam | menyapu ethernet & VLAN untuk menemukan interface baru |
| `traffic.prune` | 24 jam | membuang sampel > 7 hari |

### Kenapa penemuan dan pengambilan dipisah

**Ini soal privasi, bukan kerapian.** Router punya **1.638 interface**, dan
mayoritasnya `pppoe-in` dinamis yang **namanya adalah username pelanggan**.
Repo ini publik.

Karena itu penemuan hanya menyapu `/rest/interface/ethernet` dan
`/rest/interface/vlan` — dua resource yang secara bentuk tidak pernah memuat
interface pelanggan — sementara counter ditanyakan **satu per satu berdasarkan
nama**. Menyaring setelah diterima berarti kita sudah menerimanya; menyaring
di router berarti data itu tidak pernah dikirim. Ada tes yang menahannya tetap
begitu.

**Diperiksa di router sungguhan 20 Agustus 2026: resource per-tipe hanya
memberi NAMA, tidak memberi counter.** Karena itu dua langkah ini tidak bisa
digabung jadi satu panggilan — rancangan yang mengasumsikannya akan gagal di
produksi, bukan di tes.

### Batas presisi yang akan menggigit dalam hitungan bulan

`rx-byte` datang sebagai **string**, dan `Number("9007199254740993")`
menghasilkan `…992`. Pada uplink ±3 Gbps (≈375 MB/detik), counter melewati
`Number.MAX_SAFE_INTEGER` setelah **±280 hari uptime**. Sesudah itu dua
pembacaan berdekatan membulat ke angka yang sama, deltanya jadi **0**, dan
grafik trafik turun ke nol **tanpa satu galat pun**.

Ini bukan kekhawatiran teoretis: counter `sfp-sfpplus1` saat ditulis sudah
**2,54 × 10¹⁵** — 28% jalan menuju batasnya. Karena itu parsing wajib
`BigInt`, dan ada tes yang membuktikan versi `Number()` gagal HANYA di kasus
itu (lulus 14 dari 15 kasus lain).

### Aturan yang menolak titik, bukan mengarang angka

| Keadaan | Yang terjadi |
|---|---|
| Cuplikan pertama | disimpan sebagai ACUAN (`dt_ms = 0`), tidak jadi titik |
| Counter turun | **RESET** — tidak ada titik. Bukan wrap: counter 64-bit butuh ratusan tahun, dan "menangani wrap" mengubah tiap reboot jadi lonjakan 18 exabyte |
| Reset satu arah | membatalkan **keduanya** — reset itu peristiwa perangkat |
| Jeda < 2 detik | ditolak: satu paket jitter jadi galat puluhan Mbps |
| Jeda > 6 menit | ditolak: satu titik rata-rata **menutupi** matinya collector |
| Laju mustahil | ditolak |

**Jitter tidak merusak kebenaran.** `dt_ms` diukur dari stempel waktu nyata,
bukan diasumsikan 30.000 ms — tick yang meleset jadi 33 detik menghasilkan
rata-rata 33 detik yang benar. Jitter membeli resolusi, bukan kesalahan.

### Memberi label interface

Penemuan tidak pernah menimpa `label`, `role`, `site_id`, `capacity_bps`, atau
`is_enabled` — deploy tidak boleh menyalakan kembali apa yang sengaja
dimatikan orang. Pelabelan dilakukan sekali lewat SQL:

```sql
UPDATE traffic_interfaces SET role='uplink', label='Uplink Utama',
       capacity_bps=10000000000 WHERE if_name='sfp-sfpplus1';
```

**`role='site'` boleh tanpa `site_id`.** `102-VLAN-Seraya` menaungi Seraya
Barat DAN Seraya Tengah; menautkannya ke salah satu akan salah, jadi ia diberi
label `Seraya (Barat + Tengah)` tanpa situs.

### Keadaan saat ditulis

27 interface ditemukan, 17 dipantau. Uplink 3.034 Mbps masuk / 315 Mbps
keluar — sekelas dengan `ifInOctets_rate` LibreNMS (2.826/236); bedanya
jendela waktu, dan itu **normal**, bukan gangguan.

## 11.5. Deteksi gangguan massal

`GET /api/v1/outages` menjawab **"apa yang harus didatangi"**, bukan "berapa
yang padam". Angka total sendirian tidak bisa dipakai memutuskan apa pun: 39
padam tersebar di 39 ODP adalah 39 modem yang dicabut sendiri, tidak ada yang
perlu didatangi. 39 padam dengan 20 di antaranya pada SATU ODP adalah jalur
putus, dan satu teknisi menyelesaikan 20 keluhan. Angka totalnya sama persis.

```
diharapkan = odp_customers WHERE subscription_status = 'ACTIVE'
hadir      = pppoe_sessions.username          (ditulis ulang tiap 60 detik)
padam      = diharapkan − hadir
```

**Aturan per tingkat:**

| Tingkat | Menyala bila |
|---|---|
| ODP | padam ≥ **2** |
| OLT | padam ≥ 2 **DAN** ≥ 50% pelanggannya **DAN tersebar di >1 ODP** |
| SITUS | sama, dihitung atas seluruh pelanggan situs |

Tingkat yang lebih tinggi **menelan** yang lebih rendah — satu situs padam
tidak boleh muncul sebagai 40 alarm ODP yang mengubur satu-satunya baris
berguna.

**Syarat "tersebar di lebih dari satu ODP" itu yang paling penting**, dan baru
terlihat perlunya setelah tesnya dijalankan. Tanpa itu, satu kabel drop yang
memutus dua tetangga pada ODP yang sama dilaporkan sebagai "OLT padam" — dan
orang dikirim memeriksa perangkat yang sehat sementara kabel yang putus tidak
disebut sama sekali. Salahkan tingkat **terdalam** yang masih menjelaskan
seluruh padamnya.

**Ambang 2 sama dengan CRM, dan itu disengaja.** Dua aplikasi yang menyebut
angka berbeda untuk gangguan yang sama membuat orang berhenti mempercayai
keduanya.

**ISOLATED/INACTIVE tidak pernah dihitung.** 85 pelanggan terisolir memang
tidak online, selamanya; tanpa aturan ini mereka menyalakan gerombol permanen
yang tidak bisa dipadamkan siapa pun, dan orang berhenti membaca alarmnya
dalam seminggu.

`padamTersebar` dilaporkan terpisah dan **sengaja tidak jadi alarm** — berguna
sebagai latar ("29 tersebar" itu hari normal), tapi mendatanginya satu per
satu bukan pekerjaan siapa pun.

**Keadaan saat ditulis (20 Agustus 2026):** 1.574 pelanggan aktif, **29
padam, 0 gerombol** — semuanya tersebar satu-satu. Itu jaringan sehat, dan
jawaban yang benar adalah "tidak ada yang perlu didatangi". Angkanya bergerak
tiap putaran polling 60 detik; selisih 1–2 antar pembacaan itu normal.

## 11.4. `probe.sync` — supaya jebakan §11.3 tidak terulang

§11.3 diselesaikan sekali dengan SQL. Itu memperbaiki hari itu saja: aset
berikutnya akan mengulang jebakan yang sama, dan **gejalanya tidak terlihat
seperti kesalahan** — perangkat baru sekadar muncul kuning, dan tidak ada yang
tahu kenapa.

Sampai 20 Agustus, `probe_targets` **hanya bisa dibuat manual** lewat
`POST /api/v1/probe-targets`. Tidak ada apa pun yang menautkannya ke aset;
ketujuh baris di produksi punya `asset_id` kosong sejak awal.

Tugas berjadwal `probe.sync` (tiap jam) menutupnya:

- aset punya `management_ip` tapi belum ada sasarannya → **dibuat**
- sasaran alamatnya cocok tapi `asset_id` kosong → **ditautkan**

Port sasaran baru: **`telnet_port` OLT-nya** kalau aset itu OLT, selain itu
**443**. Menyambung ke 443 pada OLT yang hanya membuka 1023 berarti DOWN palsu
tiap 60 detik — alarm yang tidak mengatakan apa pun tentang perangkatnya.

**Tiga hal yang sengaja TIDAK dilakukannya:**

1. **Tidak pernah menghapus.** Berhenti memantau sesuatu adalah keputusan,
   bukan efek samping penyelarasan.
2. **Tidak membajak sasaran yang sudah tertaut ke aset lain.** Kalau dua aset
   berbagi alamat, memindah tautannya diam-diam membuat status satu perangkat
   muncul di perangkat lain.
3. **Tidak membuat sasaran kedua untuk alamat yang sudah punya** — termasuk
   yang sengaja dinonaktifkan.

**Cara berhenti memantau sebuah perangkat: setel `is_active = false`, JANGAN
dihapus.** Sasaran yang dinonaktifkan tetap ada, jadi sinkron membiarkannya.
Sasaran yang dihapus akan dibuat ulang pada putaran berikutnya.

## 11.3. Status perangkat tanpa SNMP datang dari probe

`192.168.100.10` tidak akan pernah masuk LibreNMS (§11.1). Sampai 20 Agustus
aset seperti itu jatuh ke **`warning`** dengan alasan yang tertulis di kode:
*"belum dikenal LibreNMS → butuh perhatian operator"*.

Alasan itu benar untuk aset yang salah konfigurasi, dan **salah** untuk aset
yang memang tidak di-SNMP. Akibatnya perangkat itu kuning **selamanya**: tidak
ada yang bisa dikerjakan untuk membuatnya hijau. Warna peringatan yang tidak
pernah berubah mengajari orang mengabaikan warna peringatan — dan itu merusak
kegunaan warna kuning untuk enam perangkat lainnya juga.

Jawabannya ternyata sudah ada dan tidak terpakai: **probe TCP portal ini sudah
memeriksa ketujuh perangkat tiap 60 detik**, termasuk `192.168.100.10:1023`,
dan ketujuhnya menjawab UP. Yang kurang cuma tautannya — `probe_targets.asset_id`
kosong di semua baris, jadi hasilnya tidak pernah sampai ke daftar perangkat.

Sesudah ditautkan (`UPDATE probe_targets SET asset_id = … WHERE address =
management_ip`), aset tanpa perangkat LibreNMS memakai hasil probe:

| `probe_targets.last_status` | Status aset |
|---|---|
| `UP` | `online` |
| `DOWN` | `offline` |
| apa pun selain itu, termasuk belum pernah diperiksa | `warning` |

**Nilai tak dikenal jatuh ke `warning`, bukan `online`.** Menebak ke arah
"sehat" membuat layar berbohong ke arah yang paling menenangkan, dan itu arah
yang paling mahal.

Probe adalah sumber **cadangan**, bukan pengganti: aset yang punya perangkat
LibreNMS tetap memakai status LibreNMS. Kalau tabel probe gagal dibaca,
daftarnya tidak ikut jatuh — ia kembali ke perilaku lama.

**Kalau kelak menambah aset baru, tautkan juga probe-nya**, kalau tidak ia
muncul kuning tanpa sebab yang bisa ditindaklanjuti.

## 11.2. Aset nyata, dan jalur ALUS yang ternyata mati

**20 Agustus 2026.** Sampai tanggal itu tabel `assets` berisi **15 perangkat
fiktif** — Menteng, Cawang, Kuningan, Bintaro, IP `10.x.x.x`. PerumNet ada di
Bali. Tidak satu pun punya `librenms_device_id`, jadi tidak satu pun pernah
menampilkan data sungguhan. Sudah dihapus bersama 15 baris `sla_monthly`
fiktifnya.

Penggantinya datang dari dua sumber, dan perlu dua-duanya:

| Sumber | Perangkat | Kenapa perlu |
|---|---|---|
| LibreNMS (SNMP) | 6 | menautkan telemetry hidup lewat `librenms_device_id` |
| Konsol CLI | 1 | `192.168.100.10` tidak mendukung SNMP (§11.1) |

Aset dari konsol (`cli-192-168-100-10`) memuat yang justru **tidak** diberikan
SNMP: nomor seri `H8GB202107230003`, versi firmware, versi perangkat keras.
Dibaca dengan `show version` lewat `POST /api/v1/devices/console` — satu
perintah baca, tercatat di audit seperti semua yang lain.

### `172.30.10.6` tidak terjangkau dari VPS

Diuji langsung: ports 23, 231, 232, 1024, 1025 di `172.30.10.6` **tidak satu
pun menjawab**. Itu jalur port-forwarding milik ALUS. Artinya **5 dari 6 OLT
terdaftar dengan alamat yang portal tidak akan pernah bisa hubungi** — dan
tidak ada yang tahu, karena tidak ada yang pernah mencoba menghubunginya.

Semua OLT menjawab di jaringan dalam. Nomor portnya **diteruskan apa adanya**
oleh ALUS, jadi pemetaannya bukan tebakan:

| OLT | Dulu (mati) | Sekarang | Bukti |
|---|---|---|---|
| HSGQ-100-Kecicang | — | `192.168.100.10:1023` | sudah benar sejak awal |
| HSGQ-102-SerayaBarat | `172.30.10.6:1024` | `192.168.100.11:1024` | port cocok persis; `show version` berhasil |
| HSGQ-102-SerayaTengah | `172.30.10.6:1025` | `192.168.100.12:1025` | port cocok persis; `show version` berhasil |
| ZTE-C300-102-Pesagi | `172.30.10.6:23` | `192.168.100.30:23` | satu-satunya C300, dipastikan dari `sysDescr` |
| ZTE-C600-100-Kecicang | `172.30.10.6:231` | `192.168.100.60:23` | dipastikan pemilik 20 Agu (lihat di bawah) |
| ZTE-C600-104-Abang | `172.30.10.6:232` | `192.168.100.61:23` | dipastikan pemilik 20 Agu (lihat di bawah) |

**Keenam OLT kini menjawab `show version` lewat konsol** — sebelumnya hanya
satu. Diuji langsung 20 Agustus.

> **Koreksi 22 Agustus 2026 — tabel di atas benar, databasenya tidak.**
>
> Pengujian 20 Agustus dilakukan dengan menghubungi alamat LAN secara manual.
> Nilai di kolom "Sekarang" **tidak pernah masuk `olt_devices`**; lima dari
> enam baris tetap menyimpan `172.30.10.6` sampai hari ini. Jadi selama dua
> hari fitur konsol gagal untuk lima OLT — dan gagalnya berupa waktu-habis,
> bukan pesan yang bisa dijelaskan siapa pun.
>
> Diuji ulang dari VPS 22 Agustus: `172.30.10.6` port 23, 231, dan 1024 tidak
> menjawab satu pun; keenam alamat LAN menjawab semua. Database sudah
> diperbaiki, dengan lima baris audit `olt.address_fixed` yang memuat nilai
> sebelum dan sesudahnya.
>
> **Sebabnya bertahan:** `scripts/impor-dari-crm.ts` menyalin `management_ip`
> dan `telnet_port` dari CRM apa adanya, dan CRM memang menyimpan alamat jalur
> luar. Setiap kali impor dijalankan, perbaikan manual akan hilang lagi.
> Importir sekarang **tidak lagi menyentuh kedua kolom itu** saat memperbarui
> — alasannya sama dengan `site_id` di berkas yang sama — dan dijaga
> `tests/impor-crm-alamat-olt.test.ts`. OLT yang benar-benar baru tetap
> memakai alamat CRM sebagai titik awal, tapi impornya mencetak peringatan
> bahwa alamat itu perlu diperiksa dari VPS.
>
> **Pelajaran yang lebih besar dari alamatnya:** perbaikan ini sudah tertulis
> lengkap di dokumen ini selama dua hari, dan tidak ada satu pun yang
> memeriksa apakah dokumen dan database sepakat. Dokumen yang menulis
> "Sekarang" tanpa ada yang menguji ulang isinya adalah dokumen yang
> menenangkan tanpa dasar. Alamat yang terbukti menjawab kini juga tercatat
> di `docs/referensi/nama-olt.json`.

Ini pengulangan persis pelajaran MikroTik: `managementUrl` router dulu juga
memakai alamat luar, dan penarikan PPPoE berhenti gagal begitu ia dipindah ke
IP internal. **VPS satu jaringan dengan MikroTik, OLT, dan switch** — alamat
luar tidak diperlukan, dan diam-diam tidak berfungsi.

### Dua C600: dipastikan orang, bukan disimpulkan sistem

`192.168.100.60` dan `192.168.100.61` keduanya ZTE C600, keduanya di port 23.
**Tidak ada yang membedakan keduanya dari luar**: `sysName` keduanya `zxan`
(bawaan pabrik, tidak pernah dikonfigurasi), `sysDescr` sama, lokasi di
LibreNMS masih alamat pabrik ZTE di Shanghai. Empat OLT lain terpetakan dari
bukti — nomor port yang diteruskan apa adanya, atau model dari `sysDescr` —
tapi untuk dua ini tidak ada bukti apa pun.

**Pemilik memastikan 20 Agustus 2026: `192.168.100.60` = Kecicang,
`192.168.100.61` = Abang.** Dicatat sebagai keterangan orang, bukan hasil
pemeriksaan, supaya siapa pun yang meragukannya nanti tahu harus bertanya ke
siapa dan tidak mencari bukti yang tidak pernah ada.

Dikonfirmasi ulang pemilik kemudian hari yang sama, dengan kalimat yang sama:
`.60` Kecicang, `.61` Abang. Dua kali sebut, konsisten.

Kalau kelak `sysName` kedua OLT ini dikonfigurasi (mis. `prm_kecicang_olt`),
keterangan ini bisa diganti bukti. **Ditunda atas keputusan pemilik
20 Agustus 2026** — jangan diangkat lagi sebagai langkah berikutnya. Ia juga
satu-satunya perubahan di daftar ini yang menuntut perintah **TULIS** ke
perangkat, jadi ia di luar batas baca-saja portal: yang menjalankannya harus
orang, bukan portal ini.

### Kelemahan yang ini menyingkap: `konsolSiap` bukan "terjangkau"

`GET /api/v1/ftth/olts` melaporkan `konsolSiap: true` untuk keenam OLT bahkan
ketika lima di antaranya menunjuk alamat mati. Field itu memeriksa
**kelengkapan konfigurasi** — ada `telnet_port`, ada kredensial — bukan apakah
perangkatnya menjawab. Itu memang rancangannya (memeriksa jangkauan berarti
membuka koneksi ke enam perangkat setiap kali daftar dimuat), tapi namanya
menjanjikan lebih dari yang ia periksa. Yang tidak terjangkau muncul sebagai
**502** saat perintah dijalankan.

## 11.1. `192.168.100.10` sengaja TIDAK di-SNMP-kan

`HSGQ-100-Kecicang` di `192.168.100.10` tidak mendukung SNMP. **Diputuskan
pemilik 20 Agustus 2026: memang tidak akan di-SNMP-kan** — jalan bacanya
konsol CLI dari dalam portal (§13), bukan LibreNMS.

Jadi ia tidak akan pernah muncul di daftar perangkat LibreNMS, dan itu **bukan
gejala kerusakan**. Jangan menyarankan menambahkannya lewat community
`perumnetro`; saran itu sudah ditolak sadar.

Keadaannya hari ini: terdaftar di `olt_devices`, `telnet_port` 1023,
`credential_ref` `OLT_KCC_HSGQ_CRED`, `konsolSiap: true`. Diuji 19 Agustus —
`show version` mengembalikan 12 baris.

Konsekuensinya, dan ini yang perlu diingat: **satu-satunya cara membacanya
dari portal adalah layar konsol (T-15).** Selama layar itu belum ada, perangkat
ini cuma nama di daftar — endpointnya jalan, tapi tidak ada yang bisa
memanggilnya tanpa curl.

## 12. Impor data jaringan dari CRM

CRM sudah memuat situs, subnet, ODP, port, dan OLT yang dimasukkan orang dengan
susah payah. `npm run impor:crm` memindahkannya ke portal ini supaya tidak ada
yang perlu mengisi ulang.

```bash
cd ~/apps/noc-portal
set -a; . ~/apps/crm/.env; set +a
CRMIP=$(docker inspect perumnet-crm-db-1   --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
export CRM_DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${CRMIP}:5432/${POSTGRES_DB}"
set -a; . ./.env.production; set +a
NODE_ENV=production npx tsx scripts/impor-dari-crm.ts --dry-run   # lihat dulu
NODE_ENV=production npx tsx scripts/impor-dari-crm.ts             # baru jalankan
```

Port database CRM sengaja tidak dipetakan ke host, jadi alamatnya diambil dari
IP container — bukan `localhost`.

**Sifatnya:** baca-saja terhadap CRM, dan **idempoten** — dijalankan dua kali
menghasilkan `0 baru, semuanya diperbarui`, bukan duplikat. Sudah dibuktikan
19 Agustus 2026 (577 ODP dan 8.632 port tetap 577 dan 8.632).

**Yang sengaja TIDAK dibawa:** identitas pelanggan. Dari `OdpPort` hanya
`subscriptionId` yang diambil — ID di sistem lain, bukan nama/alamat/nomor.
**Repo ini publik**; kalau CRM kelak menambah kolom identitas, skrip impor
tidak boleh ikut mengambilnya.

`credentialRef` OLT **ikut dibawa** — catatan lama di sini yang bilang
"ditinggal" salah. Ia NAMA env var, bukan kata sandinya, dan justru itu yang
membuat portal tahu env mana yang harus diisi. Kata sandinya tidak pernah
keluar dari env server.

`site_id` OLT sengaja **tidak** ditulis oleh impor: CRM tidak punya kolomnya,
jadi menulisnya berarti menimpa tautan situs yang benar dengan null tiap kali
impor dijalankan. Tautan itu dibuat sekali dari akhiran nama OLT (20 Agustus
2026) dan bertahan melewati impor berikutnya — sudah dibuktikan.

**ODP ke OLT (20 Agustus 2026).** Sampai tanggal itu ke-577 ODP punya
`olt_id` kosong, jadi tiap OLT melaporkan 0 ODP. Sempat dikira harus ditebak
dari nama situs — **tidak perlu**: CRM menyimpannya lewat `Odp.ponPortId` →
`PonPort.oltId`, dan ke-577-nya punya `ponPortId`. Menebak dari situs justru
pasti salah untuk sebagian, karena **Kecicang punya dua OLT** dan ODP-nya
terbagi 20 / 180. Sesudah impor: 577 tertaut, 0 yatim.

| OLT | Situs | ODP |
|---|---|---|
| HSGQ-100-Kecicang | Kecicang | 20 |
| HSGQ-102-SerayaBarat | Seraya Barat | 77 |
| HSGQ-102-SerayaTengah | Seraya Tengah | 55 |
| ZTE-C300-102-Pesagi | Pesagi | 114 |
| ZTE-C600-100-Kecicang | Kecicang | 180 |
| ZTE-C600-104-Abang | Abang | 131 |

## 13. Menerapkan migrasi ke database produksi

**`npx drizzle-kit migrate` TIDAK dipakai untuk produksi.** `DB_MIGRATION.md`
menulis perintah itu, dan itu benar untuk dev — tapi bukan untuk VPS. Dua
alasan: belum pernah dipastikan `DATABASE_URL` tersedia untuk proses
drizzle-kit di sana, dan `src/instrumentation.ts` sengaja tidak menjalankan
migrasi otomatis saat aplikasi naik.

### Prosedur yang terbukti (21 Agustus 2026, migrasi `0008_otb_tray_port`)

**0. Periksa dulu, jangan langsung terapkan.**

```bash
ssh perumnet 'docker exec perumnet-noc-postgres \
  psql -U perumnet_noc -d perumnet_noc -c \
  "select count(*) from drizzle.__drizzle_migrations;"'
ls drizzle/pg/0*.sql | wc -l
```

Kedua angka harus sama. Kalau tidak, **berhenti** dan baca §13.1 sebelum
menyentuh apa pun.

**1. Kirim berkas SQL-nya.**

```bash
scp drizzle/pg/00NN_nama.sql perumnet:/tmp/
ssh perumnet 'docker cp /tmp/00NN_nama.sql perumnet-noc-postgres:/tmp/'
```

**2. Terapkan dalam satu transaksi.**

```bash
ssh perumnet 'docker exec perumnet-noc-postgres psql -U perumnet_noc \
  -d perumnet_noc -v ON_ERROR_STOP=1 --single-transaction -f /tmp/00NN_nama.sql'
```

`ON_ERROR_STOP=1` dan `--single-transaction` dua-duanya wajib. Tanpa keduanya
psql akan melanjutkan setelah galat dan meninggalkan skema setengah jadi —
keadaan yang jauh lebih mahal diperbaiki daripada migrasi yang gagal utuh.

**3. Catat sendiri barisnya.** Drizzle tidak akan tahu migrasi itu sudah
diterapkan kalau tidak dicatat.

```sql
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
VALUES ('<sha256 berkas sql>', <nilai "when" dari _journal.json>);
```

- `hash` = `shasum -a 256 drizzle/pg/00NN_nama.sql`
- `created_at` = milidetik, ambil dari `when` entri itu di
  `drizzle/pg/meta/_journal.json`

**Timestamp-nya yang menentukan, bukan hash-nya.** Drizzle memilih migrasi
mana yang perlu dijalankan berdasarkan `created_at` TERBESAR yang tercatat.
Angka yang salah di sini tidak akan menghasilkan galat apa pun — ia hanya
membuat migrasi berikutnya dilewati diam-diam, dan itu baru ketahuan berbulan
kemudian saat sebuah kolom "hilang" tanpa penjelasan.

**4. Baru deploy kodenya.** `git pull --ff-only`, `npm run build`,
`pm2 restart perumnet-noc --update-env`. Urutannya penting: skema lebih dulu,
kode belakangan. Kode baru yang menemui tabel lama akan 500; tabel baru yang
belum dipakai kode lama tidak melakukan apa-apa.

### 13.1. Drift yang pernah terjadi — dan cara memperbaikinya

Sampai 21 Agustus 2026 `drizzle.__drizzle_migrations` hanya memuat **5 baris**
(0000–0004), padahal **0005, 0006, dan 0007 sudah lama terpasang** —
`odp_customers`, `traffic_interfaces`, `traffic_samples`, dan `tv_tokens`
semuanya ada dan berisi data produksi.

Akibatnya, siapa pun yang mengikuti `DB_MIGRATION.md` apa adanya dan
menjalankan `drizzle-kit migrate` akan membuat drizzle mencoba menerapkan
0005 ke atas, gagal di `CREATE TABLE "odp_customers"` karena tabelnya sudah
ada, dan berhenti di tengah. Bukan kerusakan data, tapi kegagalan yang
membingungkan pada saat paling buruk — di tengah deploy.

Perbaikannya bukan menerapkan ulang, melainkan **mencatat kenyataan yang
memang sudah benar**: cocokkan `shasum -a 256` tiap berkas dengan `hash` yang
tercatat, temukan yang hilang, lalu `INSERT` dengan `when` dari jurnalnya.
Sudah dilakukan; tabel pelacak sekarang berisi 9 baris dan jujur.

**Pelajarannya bukan "hati-hati".** Pelajarannya: langkah 0 di atas ada
justru karena kegagalan ini tidak menimbulkan gejala apa pun sampai migrasi
berikutnya. Jalankan langkah 0 setiap kali.

### 13.2. Keadaan app PerumNet yang lain (diperiksa 21 Agustus 2026)

Diperiksa karena drift di atas — supaya jelas ini kasus tunggal atau pola.
**Catatan: app lain hanya DIPERIKSA, tidak diubah.**

| App | Database | Tabel | Pelacak migrasi | Keadaan |
|---|---|---|---|---|
| monitoring-noc | `perumnet_noc` | 40 | Drizzle | Sempat melenceng 3 migrasi — **sudah diperbaiki**, 9/9 |
| warehouse | `perumnet_warehouse` | 232 | Prisma | **Sehat**: 36 tercatat = 36 berkas, nol belum-selesai, nol rollback |
| warehouse (pratinjau) | `…_pratinjau` | 232 | Prisma | Sehat, 36/36 |
| crm | `perumnet_crm` | 141 | **tidak ada** | Memakai `prisma db push` — memang tanpa riwayat |
| enterprise | `perumnet_enterprise` | 83 | **tidak ada** | Tanpa berkas migrasi sama sekali — juga push |

Bedakan dua hal ini, karena mudah tertukar:

- **Drift** (kasus NOC): berkas migrasi ada, pelacak ada, tapi keduanya tidak
  cocok. Ini bug, dan bisa diperbaiki.
- **Tanpa riwayat** (CRM dan enterprise): memang tidak pernah ada migrasi
  bernomor. `db push` membandingkan skema lalu menerapkan selisihnya. Itu
  bukan drift — itu model deployment yang berbeda, dan konsekuensinya nyata:
  tidak ada catatan apa yang diterapkan kapan, tidak ada jalur rollback per
  langkah, dan `push` bisa **menghapus kolom** tanpa bertanya kalau skemanya
  berubah. Keputusan pemilik masing-masing app; dicatat di sini supaya tidak
  dikira temuan yang perlu ditindak.

Jadi drift itu kasus tunggal, bukan pola.
