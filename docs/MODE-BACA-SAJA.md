# Mode baca-saja — portal NOC tidak bertindak keluar

Berlaku sejak **19 Agustus 2026**. Saudaranya di CRM:
`../crm/docs/MODE-BACA-SAJA.md` (16 Agustus 2026).

Operasional sungguhan PerumNet masih berjalan di `perumnet.alus.co.id`. Selama
itu benar, portal NOC **tidak boleh bertindak keluar**. Kalau portal bertindak
sementara ALUS juga melakukannya, pelanggan menerima dua perlakuan dari dua
sistem yang tidak saling tahu — dihubungi dua kali, atau menerima kabar yang
tidak dikenal siapa pun di kantor.

## Apa artinya "baca-saja" di aplikasi ini

**Boleh** — menulis ke database sendiri: insiden, sesi & audit login, topologi,
pemetaan layanan CRM, riwayat notifikasi, pengguna, catatan ekspor laporan.
Membaca dari LibreNMS juga boleh; bertanya bukan bertindak.

**Tidak boleh** — mengirim notifikasi ke orang, dan mendorong data ke sistem
lain.

## Bedanya dengan CRM, dan kenapa tidak disalin mentah

Tiga hal, supaya tidak ada yang "menyeragamkan" keduanya ke arah yang salah:

1. **CRM punya penjadwal; aplikasi ini tidak punya sama sekali.** CRM menjaga
   9+ pekerjaan terjadwal di `runDueTasks()`. Di sini tidak ada worker, cron,
   `setInterval`, maupun skrip `worker` — PM2 hanya menjalankan `next start`.
   Tidak ada yang berjalan kecuali ada orang menekan tombol atau LibreNMS
   mengirim webhook. Menyalin `ScheduledTask.isEnabled` ke sini berarti memasang
   gerbang untuk jalan yang tidak ada.
2. **Mode baca-saja CRM adalah keadaan DATA; di sini keadaan KODE.** Di CRM ia
   lima baris `isEnabled=false` yang **dibatalkan oleh database baru** (empat
   dari lima tugas `enabledByDefault: true`). Di sini bawaannya memblokir, jadi
   VPS baru, container baru, atau `.env` yang dipulihkan dari cadangan lama
   semuanya naik dalam keadaan terkunci.
3. **Tombol manual di CRM melewati gerbangnya sepenuhnya.** Siapa pun dengan
   izin RBAC yang tepat masih bisa menekan tombol dan mengirim WhatsApp
   sungguhan. Di sini penjaganya duduk di transport, jadi jalur manual pun
   menabraknya — **untuk ketiga transport yang kita kenal.**

## Tiga jalur keluar yang dijaga

| Fungsi | Kalau lolos, ia | Env yang mempersenjatai | Penjaga |
|---|---|---|---|
| `notifyCrm()` (`src/server/crm-webhook.ts`) | POST insiden ke CRM | `CRM_WEBHOOK_URL` | sesudah cek URL + `outwardFetch` |
| `sendTelegram()` (`src/server/notifier.ts`) | POST ke Telegram Bot API | `TELEGRAM_BOT_TOKEN` | sesudah cabang simulasi + `outwardFetch` |
| `sendWhatsApp()` (`src/server/notifier.ts`) | POST ke gateway WA | `WHATSAPP_API_URL` | sesudah cabang simulasi + `outwardFetch` |

Saklarnya satu: **`OUTWARD_ACTIONS`**. Bernilai persis `ALLOWED` membuka;
selain itu — termasuk tidak diisi dan salah ketik — memblokir.

**Yang tercatat saat ditahan.** Satu baris `audit_logs` dengan
`action = 'outward.blocked'`, `actor_label = 'system:outward-guard'`. Alert yang
ditahan **tidak** menulis baris `notification_deliveries`: `failed` akan jadi
tembok kegagalan palsu yang melatih NOC mengabaikan angka gagal, dan `sent`
adalah kebohongan dalam catatan operasional. Jumlahnya masuk ke field `skipped`.

## Yang sengaja TIDAK dijaga, dan kenapa

- **Semua endpoint yang menulis ke database portal** — acknowledge insiden, edit
  topologi, kelola pengguna, daftar channel, ekspor laporan. Memblokirnya
  mengubah mode bayangan jadi mode pajangan: aplikasi yang tidak bisa dipakai
  tidak akan pernah tervalidasi sebelum cutover, dan itu justru menggagalkan
  tujuan aturan ini. Yang menentukan siapa boleh apa tetap `withRole`.
- **Pembacaan LibreNMS** (`librenmsFetch`, discovery topologi, proxy grafik RRD)
  — GET semua. Discovery topologi memang mengirim HTTP keluar; jangan diblokir
  hanya karena cocok dengan pola "HTTP keluar".
- **Probe IMAP** di `mail-auth.ts` — membuka TLS ke port 993, `LOGIN` lalu
  `LOGOUT`, tidak membaca kotak surat. Memblokirnya akan mengunci semua orang
  dari portal saat `AUTH_PROVIDER=MAILSERVER`, termasuk orang yang hendak
  memperbaikinya.
- **Pemetaan layanan CRM** (`POST /api/v1/integrations/crm/service-mappings`)
  boleh ditulis, tapi **tidak berdaya** selama mode memblokir. Ia menentukan
  insiden mana yang *akan* didorong nanti — persis pekerjaan persiapan yang
  memang ingin selesai sebelum cutover.
- **Menarik (GET) dari CRM** juga tidak dilarang aturan ini. Yang dilarang
  mendorong. Jangan blokir integrasi baca di masa depan karena salah membaca
  dokumen ini.

## Menyalakannya nanti

Isi `OUTWARD_ACTIONS=ALLOWED` di `.env.production`, lalu **restart** (env dibaca
saat boot; reload biasa tidak cukup).

Tapi variabelnya bukan bagian yang sulit. **Pastikan ALUS sudah berhenti
melakukan hal yang sama lebih dulu** — bukan berjalan berdampingan. Itu
keputusan pemilik, bukan keputusan teknis, dan urutannya tidak boleh dibalik.

Sebelum `TELEGRAM_BOT_TOKEN` pernah diisi, tutup dulu lubang di §Yang tidak
dijamin butir 4.

## Memastikan keadaannya

- `GET /api/read-only-mode` (cukup login) → `{"readOnly": true, ...}`.
- `SELECT count(*) FROM audit_logs WHERE action = 'outward.blocked';` — berapa
  kali aksi keluar ditahan.
- Bedanya dengan gagal kirim: `crm_webhook.failed` berarti **dicoba lalu
  gagal**; `outward.blocked` berarti **tidak pernah dicoba**. Yang pertama perlu
  ditindaklanjuti, yang kedua tidak.

## Yang TIDAK dijamin

Ditulis supaya tidak ada yang selesai membaca dokumen ini lalu merasa portalnya
tertutup rapat.

1. **Tidak menjaga tulisan ke database sendiri.** Memang begitu definisinya.
2. **Uji penyisir sumber (`tests/no-outward-fetch-guard.test.ts`) adalah grep,
   bukan sandbox.** Ia tidak melihat panggilan lewat dependensi npm,
   `globalThis["fe"+"tch"]`, atau Server Action di luar `src/app/api`. Jaminan
   yang sesungguhnya adalah **aturan firewall keluar di VPS** — hanya host
   LibreNMS dan mailserver yang boleh dihubungi. Itu pekerjaan ops, belum
   dikerjakan.
3. **Siapa pun yang memegang shell atau `DATABASE_URL`** bisa mengubah saklarnya
   atau menulis langsung. Beratnya "shell + env + restart" itu fiturnya, bukan
   hambatan yang perlu dipermudah — jangan tambahkan tombol di halaman
   pengaturan, karena itu justru mengulang kelemahan CRM.
4. **`POST /api/notifications/channels/verify` belum terkunci.** Tanpa sesi,
   tanpa token, tanpa rate limit; kendalinya hanya kode 6 digit yang tidak
   pernah kedaluwarsa. Siapa pun bisa menebaknya beruntun lalu menautkan chatId
   miliknya, dan menerima alert NOC. Hari ini gigitannya tertahan karena mode
   ini menahan pengiriman — **tapi lubang itu bersenjata pada detik
   `TELEGRAM_BOT_TOKEN` diisi.** Harus ditutup sebelum itu.
5. **LibreNMS sendiri bisa bertindak ke perangkat.** Token kita read, dan uji
   penyisir menahan kode ini tetap GET — tapi hak token di sisi LibreNMS di luar
   jangkauan repo ini.

## Catatan untuk CRM

Kelemahan CRM di §Bedanya butir 3 nyata: `runOutboundQueue()`,
`runQueuedJobs()`, dan `postInvoiceRun()` punya jalur manual yang tidak melewati
gerbang mana pun. Pola di repo ini — satu penjaga di transport, dipanggil dari
jalur terjadwal **dan** jalur manual — adalah perbaikannya. Di luar lingkup
pekerjaan ini; ditulis supaya pengetahuannya tidak mati di repo ini saja.
