# PerumNet NOC Monitoring Portal

NOC Portal untuk monitoring jaringan PerumNet dengan **LibreNMS** sebagai
source of truth (discovery, SNMP polling, status, alert, availability,
health, dan grafik RRD). Portal menyimpan hanya data aplikasi: user/RBAC,
metadata aset, mapping CRM, incident, audit log, topologi, dan notifikasi.

## Fitur per fase (PRD)

| Fase | Status | Ringkasan |
|---|---|---|
| 0–2 | ✅ | Audit, domain `/api/v1`, schema PostgreSQL/Drizzle + migrasi SQLite aman |
| 3 | ✅ | Adapter server-side LibreNMS (device, port, health, alert, availability, eventlog, graph) + mode fixture berlabel |
| 4 | ✅ | Webhook alert idempoten (incidents), acknowledge + resolution note, delivery log, RBAC |
| 5 | ✅ | Topologi jaringan: edit manual, discovery → rekomendasi, review, publish/versioning |
| 6 | ✅ | Mapping CRM (minimal), portal customer dengan deep-link HMAC & isolasi ketat, webhook outbound |
| 7 | ✅ | UI ke API v1, proksi grafik RRD (PNG), PWA, responsive QA |
| 8 | ✅ | Dokumentasi deployment & operasional |

## Mulai cepat (development)

```bash
npm install
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL dev (port 5433)
cp .env.example .env.local                        # isi sesuai kebutuhan
npx drizzle-kit migrate                           # schema
node scripts/migrate-sqlite-to-postgres.mjs ./data/perumnet.db   # (opsional) seed dari SQLite
npm run dev
```

Akses `http://localhost:3000`. Tanpa `LIBRENMS_URL`/`LIBRENMS_TOKEN`
aplikasi berjalan dalam mode fixture berlabel.

## Koneksi LibreNMS

1. Buat API token read di LibreNMS (Settings → Users → API tokens /
   `lnms user:token`).
2. Set di `.env.local` (gitignored):
   `LIBRENMS_URL=https://nms.perumnet.id`, `LIBRENMS_TOKEN=<token>`.
3. Impor perangkat ke tabel aset:
   `node scripts/import-librenms-assets.mjs` (dry-run) lalu `--commit`.
4. Cek koneksi: `GET /api/v1/integrations/librenms/status` (login admin).
5. Webhook alert: Alert Transport API → `POST <portal>/api/v1/integrations/librenms/alerts`
   dengan header `x-webhook-token: <LIBRENMS_WEBHOOK_SECRET>`.

## Dokumentasi

- `docs/PROMPT_CLAUDE_IMPLEMENTASI_LIBRENMS.md` — PRD / arsitektur target
- `docs/DB_MIGRATION.md` — migrasi SQLite → PostgreSQL & rollback
- `docs/DEPLOYMENT_LIBRENMS.md` — deployment LibreNMS (Proxmox/Debian 12,
  compose, VLAN, firewall, HTTPS, SNMPv3, backup/restore, onboarding)
- `docs/OPERATIONS.md` — environment variables, contract CRM, batasan
  discovery, runbook, checklist go-live, rollback

## Verifikasi

```bash
npm run lint && npm run typecheck && npm test && npm run build
```
