# Deployment LibreNMS — Proxmox / Debian 12 (Fase 8)

Dokumentasi deployment — **bukan eksekusi server**. Portal NOC dan LibreNMS
harus berjalan pada VM terpisah.

## Arsitektur target

| Komponen | VM | Baseline | Port publik |
|---|---|---|---|
| LibreNMS | VM terpisah (Debian 12) | 4 vCPU / 8 GB RAM / 100 GB SSD | 443 (HTTPS) |
| Portal NOC (repo ini) | VM terpisah | 2 vCPU / 4 GB RAM / 50 GB SSD | 443 (HTTPS) |
| PostgreSQL Portal | VM portal (atau terpisah) | 1 vCPU / 2 GB RAM / 20 GB SSD | internal |
| Network Management VLAN | — | — | — |

Komunikasi: Portal → LibreNMS **read-only API** (`/api/v1`); LibreNMS →
Portal **webhook alert** (HTTPS). SNMPv3 read-only dari LibreNMS ke perangkat.

## 1. Proxmox — buat VM LibreNMS

1. ISO Debian 12 netinst: Proxmox → `local` → ISO Images.
2. VM: `qm create 201 --name librenms --memory 8192 --cores 4 --net0 virtio,bridge=vmbr0,firewall=1 --scsi0 local-lvm:100 --ostype l26 --boot c`.
3. Install Debian: minimal, SSH server, **tanpa** GUI.
4. Hardening dasar: `apt update && apt full-upgrade -y`, buat user non-root dengan sudo, nonaktifkan login root SSH.

## 2. Docker Compose LibreNMS

Referensi resmi: `https://github.com/librenms/docker` (image `librenms/librenms:latest`).

```yaml
# /opt/librenms/docker-compose.yml
services:
  db:
    image: mariadb:10.11
    container_name: librenms_db
    restart: unless-stopped
    volumes:
      - db_data:/var/lib/mysql
    environment:
      MYSQL_ALLOW_EMPTY_PASSWORD: "yes"
      MYSQL_DATABASE: librenms
    command: "--default-authentication-plugin=mysql_native_password"
  librenms:
    image: librenms/librenms:latest
    container_name: librenms
    restart: unless-stopped
    ports:
      - "127.0.0.1:8000:8000"   # dibalik Caddy/Nginx
    volumes:
      - librenms_data:/data
    environment:
      TZ: Asia/Jakarta
      PUID: "1000"
      PGID: "1000"
      DB_HOST: db
      DB_NAME: librenms
      DB_USER: librenms
      DB_PASSWORD: "<ganti-kuat>"
    depends_on:
      - db

volumes:
  db_data:
  librenms_data:
```

Jalankan: `docker compose up -d`; lalu `docker compose exec librenms ./scripts/manage_lnms.php post-install` (set admin + password).

## 3. Reverse proxy + HTTPS (Caddy)

Caddy otomatis memperoleh Let's Encrypt — cukup DNS A `nms.perumnet.id` → IP VM.

```caddyfile
# /etc/caddy/Caddyfile
nms.perumnet.id {
    reverse_proxy 127.0.0.1:8000
}
```

`apt install caddy && systemctl enable --now caddy`.

## 4. VLAN management & firewall

- **VLAN management** (mis. VLAN 99): semua IP manajemen perangkat + LibreNMS di VLAN ini; akses terbatas.
- **nftables/ufw** pada VM LibreNMS — hanya:
  - 443/tcp (dunia/portal), 22/tcp (SSH, IP admin), ICMP
  - blokir port lain; UI LibreNMS default `:8000` hanya localhost
- Portal NOC harus dapat keluar ke `https://nms.perumnet.id` (tidak perlu masuk).
- SNMP (udp/161) **tidak dibuka** ke internet — hanya dari VM LibreNMS ke VLAN manajemen.

```bash
ufw default deny incoming
ufw allow 22/tcp
ufw allow 443/tcp
ufw enable
```

## 5. SNMPv3 read-only

Aktifkan di perangkat (MikroTik/Ruijie/ZTE), contoh CLI MikroTik:

```
/snmp set enabled=yes
/snmp v3 set enabled=yes authentication-protocol=sha1 encryption-protocol=des
/snmp v3 add group=readonly name=ro security=aes ...
```

Atau di LibreNMS tambahkan device via UI: Devices → Add Device → masukkan hostname + SNMP v3 (user, auth pass, priv pass) → Add.

## 6. Onboarding perangkat (prosedur)

1. Pastikan IP manajemen perangkat dapat dijangkau dari VM LibreNMS.
2. Aktifkan SNMP (v2c read-only community kuat, atau lebih baik v3).
3. LibreNMS UI → Devices → **Add Device** → hostname/IP + SNMP versi + kredensial → Add.
4. Tunggu discovery pertama (~5–10 menit), cek `Devices → <device>`: OS/hardware/port terdeteksi.
5. Set lokasi & koordinat (dipakai peta Portal): device edit → Location / Lat / Lng.
6. Tambahkan device ke grup (jika portal memakai pemetaan grup CRM).
7. Portal: jalankan `scripts/import-librenms-assets.mjs --commit` (dry-run dulu).

## 7. Backup & restore

Backup harian (cron di host):

```bash
# /etc/cron.d/librenms-backup
30 2 * * * root /opt/librenms/backup.sh
```

`/opt/librenms/backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date +%F)
DIR=/backups/librenms
mkdir -p "$DIR"
docker compose -f /opt/librenms/docker-compose.yml exec -T db mysqldump --skip-lock-tables -uroot librenms | gzip > "$DIR/db-$STAMP.sql.gz"
tar czf "$DIR/data-$STAMP.tar.gz" -C /opt/librenms librenms_data   # rrd + config
find "$DIR" -name '*.gz' -mtime +30 -delete
```

Restore:

```bash
docker compose -f /opt/librenms/docker-compose.yml exec -T db mysql -uroot librenms < db-<STAMP>.sql.gz-unpacked
# + tar -xzf data-<STAMP>.tar.gz ke volume /data
docker compose -f /opt/librenms/docker-compose.yml restart librenms
```

Uji restore berkala (bulanan) — backup tanpa uji restore bukan backup.

## 8. Uji validasi go-live

- [ ] `curl https://nms.perumnet.id/api/v0/devices` dengan token → 200 `{"devices":[...]}`
- [ ] Portal: `GET /api/v1/integrations/librenms/status` (login admin) → `reachable: true`, `deviceCount > 0`
- [ ] Webhook: Alert Transport API dikonfigurasi & test alert diterima (202)
- [ ] SNMPv3 polling berjalan (halaman device LibreNMS tidak kosong)
