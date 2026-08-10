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
| `CUSTOMER_PORTAL_SECRET` | ya | HMAC deep-link portal customer |
| `CUSTOMER_SUPPORT_CONTACT` | opsional | kontak pada halaman status pelanggan |
| `CRM_WEBHOOK_URL` | opsional | notifikasi incident outbound ke CRM |
| `CRM_WEBHOOK_TOKEN` | opsional | Bearer token webhook CRM |
| `TELEGRAM_BOT_TOKEN` | opsional | notifikasi Telegram nyata (tanpa ini = simulasi) |
| `WHATSAPP_API_URL` / `WHATSAPP_API_TOKEN` | opsional | gateway WhatsApp |
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

## 7. Item yang belum dapat divalidasi tanpa infrastruktur nyata

- Integrasi penuh dengan device SNMP nyata (LibreNMS saat ini 0 perangkat —
  impor aset & discovery topologi teruji dengan mock/test unit).
- Pengiriman Telegram/WhatsApp nyata (teruji mode simulasi).
- Webhook ingress dari LibreNMS nyata (teruji HTTP langsung + unit test).
- CRM nyata (contract + adapter diuji dengan stub).
