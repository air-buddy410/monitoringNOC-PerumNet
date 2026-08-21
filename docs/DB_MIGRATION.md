# Migrasi Database: SQLite → PostgreSQL (Fase 2)

Dokumen ini menjelaskan baseline PostgreSQL, prosedur migrasi data dari era
SQLite, dan prosedur rollback.

## Ringkasan arsitektur

| Lingkungan | Database | Cara |
|---|---|---|
| Produksi / staging | PostgreSQL | set `DATABASE_URL` (lihat `.env.example`) |
| Development multi-proses | PostgreSQL lokal | `docker compose -f docker-compose.dev.yml up -d` |
| Development ringan (default) | PGlite (PostgreSQL embedded, WASM) | tanpa `DATABASE_URL`; file di `./data/pglite` — **single-process** |

Schema tunggal: `src/db/schema.ts` + `src/db/auth-schema.ts` (Drizzle
`pg-core`). Migration baseline: `drizzle/pg/0000_*.sql`. Folder `drizzle/*.sql`
lama (SQLite) adalah **arsip riwayat Fase 1** dan tidak dipakai lagi.

## Apa yang berubah dari era SQLite

**Dibawa (data dimigrasikan):** `user`, `session`, `account`, `verification`
(epoch ms → `timestamptz`), `device_metadata` → **`assets`** (rename kolom
`prtg_device_id` → `asset_id`; grup legacy dipetakan ke `vendor` +
`network_role`), `notification_channels`, `notification_logs`
(`prtg_sensor_id` → `librenms_alert_id`), `sla_reports`.

**Tidak dibawa (mock/telemetry — sesuai aturan):** `device_metrics`,
`port_metrics`, `pon_port_samples`, `onu_status_samples`, `metric_history`
(tabel telemetry DIPENSIUNKAN — LibreNMS adalah source of truth), serta isi
`sla_monthly`/`traffic_monthly` (cache turunan generator mock; tabelnya tetap
ada dan diisi ulang).

**Tabel baru (Fase 2):** `crm_service_mappings`, `incidents` (+ partial
unique index `incidents_active_alert_idx` untuk idempotency webhook),
`audit_logs`, `notification_deliveries`, `topologies`, `topology_nodes`,
`topology_links`, `topology_discovery_suggestions`, `topology_versions`.

**Kode yang dipensiunkan:** worker collector telemetry
(`src/server/collector.ts`) dan endpoint `/api/cron/collect-metrics` —
tugasnya berpindah ke LibreNMS (adapter menyusul Fase 3).

**Catatan pasca-migrasi:** `network_role` hasil mapping dari grup legacy
bersifat kasar (OLT→`olt`, selainnya `access`) — operator sebaiknya meninjau
dan mengoreksi role per aset. `librenms_device_id` bernilai `NULL` sampai
aset dipetakan ke device LibreNMS (Fase 3).

## Prosedur migrasi

```bash
# 0) (Opsional, produksi/dev multi-proses) siapkan PostgreSQL lalu set DATABASE_URL
docker compose -f docker-compose.dev.yml up -d

# 1) Terapkan schema baseline ke target — DEV SAJA.
#    Untuk database PRODUKSI di VPS jangan pakai perintah ini;
#    ikuti docs/OPERATIONS.md §13 (psql + catat barisnya sendiri).
npx drizzle-kit migrate

# 2) Salin data dari SQLite lama (read-only, idempoten — aman diulang)
node scripts/migrate-sqlite-to-postgres.mjs ./data/perumnet.db

# 3) Verifikasi jumlah baris per tabel (dicetak skrip), lalu jalankan aplikasi
npm run build && npm start
```

Skrip **tidak pernah menulis ke SQLite** (dibuka `readonly`) dan memakai
`ON CONFLICT DO NOTHING`, sehingga dapat diulang tanpa duplikasi.

## Rollback

1. **Artefak rollback**: file `data/perumnet.db` tidak diubah oleh proses
   apa pun — simpan sebagai arsip (disarankan juga menyalinnya:
   `cp data/perumnet.db backups/perumnet-$(date +%F).db`).
2. Untuk kembali ke rilis era SQLite: checkout tag/commit Fase 1
   (`git checkout 1ad94d4`), arahkan `DATABASE_PATH` ke file arsip, jalankan
   ulang aplikasi. Data pasca-cutover yang hanya ada di PostgreSQL tidak
   otomatis kembali — ekspor manual bila diperlukan.
3. Untuk PostgreSQL antar-migrasi berikutnya: selalu `pg_dump` sebelum
   `drizzle-kit migrate` (`pg_dump "$DATABASE_URL" > backups/pre-migrate.sql`);
   rollback = restore dump + checkout kode yang sesuai.
4. PGlite development dapat di-reset kapan saja dengan menghapus folder
   `data/pglite` lalu mengulang prosedur migrasi.

## Batasan yang diketahui

- PGlite bersifat single-process (satu lock per direktori data). Jika dev
  server dan skrip/CLI berjalan bersamaan, jalankan bergantian atau pakai
  Postgres docker.
- `drizzle-kit generate` berikutnya harus selalu menghasilkan migration file
  baru di `drizzle/pg/` — jangan mengedit migration yang sudah diterapkan.
- **Tabel pelacak bisa melenceng dari kenyataan, dan diamnya total.** Sampai
  21 Agustus 2026 `drizzle.__drizzle_migrations` di produksi hanya memuat
  0000–0004 padahal 0005–0007 sudah terpasang; `drizzle-kit migrate` dalam
  keadaan itu akan gagal di tengah. Sudah diperbaiki. Cara memeriksa dan
  prosedur produksi yang benar: `docs/OPERATIONS.md` §13.
