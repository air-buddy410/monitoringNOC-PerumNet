#!/usr/bin/env bash
# Cadangan harian database monitoring-noc.
#
# Dipasang di jalur TETAP di VPS (~/deploy/noc-portal/), bukan di dalam folder
# aplikasi — kalau kelak noc-portal pindah ke tata letak direktori rilis, cron
# yang menunjuk ke folder lama akan gagal diam-diam. Berkas di repo ini sumber
# kebenarannya; kalau diubah, salin ulang ke VPS.
#
# PEMASANGAN (sekali saja):
#   mkdir -p ~/deploy/noc-portal ~/.local/state/noc-portal ~/backups/noc-portal
#   scp deploy/cadangkan-database.sh <vps>:~/deploy/noc-portal/
#   chmod +x ~/deploy/noc-portal/cadangkan-database.sh
#   crontab -e   # lihat baris cron di bawah
#
# BARIS CRON (03:30 WITA — sengaja jauh dari enterprise 18:30 & warehouse 02:30):
#   30 3 * * * /usr/bin/flock -n /home/perumnet/.local/state/noc-portal/backup.lock \
#     /home/perumnet/deploy/noc-portal/cadangkan-database.sh \
#     >> /home/perumnet/.local/state/noc-portal/backup.log 2>&1
#
# MEMULIHKAN:
#   gunzip -c <berkas>.sql.gz | docker exec -i perumnet-noc-postgres \
#     psql -U perumnet_noc -d perumnet_noc
#
# ── KENAPA SKRIP INI SEREWEL ITU SOAL VERIFIKASI ──────────────────────────
# Pada 19 Agustus 2026 ditemukan bahwa perintah cadangan CRM di dokumennya
# menyebut nama database yang salah. Akibatnya: pg_dump mati, `gzip` di sisi
# kanan pipa tetap sukses, berkasnya lahir dengan nama dan tanggal yang benar,
# dan `gzip -t` menyatakannya utuh — 30 bita, nol baris. Tidak ada yang
# bersuara selama berbulan-bulan.
#
# Dua penangkalnya dipakai di sini:
#   1. `set -o pipefail` — tanpa itu, status pipa diambil dari perintah
#      TERAKHIR, dan gzip nyaris selalu sukses.
#   2. Hitung blok COPY sesudahnya. Berkas yang "utuh" tapi kosong tetap utuh
#      menurut gzip; yang membedakannya cuma isinya.
# Cadangan yang tidak pernah diperiksa adalah cadangan yang belum tentu ada.

set -euo pipefail

CONTAINER=perumnet-noc-postgres
DB_USER=perumnet_noc
DB_NAME=perumnet_noc
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/noc-portal}"
SIMPAN=14                    # berapa hari yang disimpan

# Ambil nama database dari container, bukan dari nilai yang diketik ulang di
# sini — dua sumber kebenaran bebas menyimpang, dan di CRM sudah terbukti
# menyimpang. Kalau gagal terbaca, pakai nilai di atas.
DB_ENV=$(docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null || true)
DB_NAME=$(printf '%s' "$DB_ENV" | sed -n 's/^POSTGRES_DB=//p' | head -1 || echo "$DB_NAME")
DB_USER=$(printf '%s' "$DB_ENV" | sed -n 's/^POSTGRES_USER=//p' | head -1 || echo "$DB_USER")
: "${DB_NAME:=perumnet_noc}"
: "${DB_USER:=perumnet_noc}"

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%F-%H%M)
TUJUAN="$BACKUP_DIR/noc-$STAMP.sql.gz"
# Ditulis ke nama sementara dulu, dan baru diberi nama akhir SETELAH isinya
# terbukti. Kalau ditulis langsung ke nama akhir, kegagalan di tengah jalan
# meninggalkan berkas .sql.gz kosong bertanggal hari ini — yang bagi siapa pun
# yang melihat isi folder tampak seperti cadangan yang berhasil. Ini bukan
# kekhawatiran teoretis: versi pertama skrip ini melakukannya, dan ketahuan
# justru oleh uji jalur-gagal di bawah.
SEMENTARA="$TUJUAN.part"

# Apa pun sebabnya keluar lebih awal, berkas separuh jadi tidak boleh tertinggal.
trap 'rm -f "$SEMENTARA"' EXIT

echo "[$(date -Is)] mencadangkan $DB_NAME (user $DB_USER) → $TUJUAN"
docker exec -i "$CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$SEMENTARA"

# ── Verifikasi: berkas yang lahir belum tentu berisi ──────────────────────
BYTES=$(stat -c%s "$SEMENTARA")
BLOK=$(gunzip -c "$SEMENTARA" | grep -c '^COPY ' || true)
echo "[$(date -Is)] ukuran ${BYTES} bita · ${BLOK} blok COPY"

if [ "$BLOK" -lt 1 ]; then
  echo "[$(date -Is)] GAGAL: cadangan tidak memuat satu pun blok COPY — dibuang." >&2
  exit 1
fi

mv "$SEMENTARA" "$TUJUAN"
trap - EXIT

# Buang yang lebih tua dari SIMPAN hari. Dijalankan hanya setelah cadangan hari
# ini terbukti berisi — supaya cadangan lama tidak pernah dihapus demi cadangan
# yang ternyata kosong.
find "$BACKUP_DIR" -name 'noc-*.sql.gz' -type f -mtime +"$SIMPAN" -print -delete

echo "[$(date -Is)] selesai · $(ls -1 "$BACKUP_DIR"/noc-*.sql.gz | wc -l) cadangan tersimpan"
