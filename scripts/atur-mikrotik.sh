#!/usr/bin/env bash
# Menyetel kredensial MikroTik untuk penarikan sesi PPPoE.
#
# Dijalankan DI VPS, di dalam ~/apps/noc-portal:
#   bash scripts/atur-mikrotik.sh
#
# Kata sandinya diketik langsung di sini — tidak lewat argumen (yang akan
# terlihat di `ps` dan riwayat shell), dan tidak pernah ditampilkan di layar.
#
# Sebelum menyimpan, skrip ini MENGUJI kredensialnya ke router. Menyimpan
# kredensial yang salah lalu menunggu tugas terjadwal gagal diam-diam adalah
# cara paling lambat untuk mengetahui bahwa passwordnya keliru.

set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.production}"
[ -f "$ENV_FILE" ] || { echo "Tidak menemukan $ENV_FILE — jalankan dari ~/apps/noc-portal."; exit 1; }

URL_BAWAAN="https://192.168.100.1"
read -r -p "Alamat RouterOS [$URL_BAWAAN]: " URL
URL="${URL:-$URL_BAWAAN}"
URL="${URL%/}"

read -r -p "Username (akun BACA-SAJA sudah cukup): " USR
[ -n "$USR" ] || { echo "Username tidak boleh kosong."; exit 1; }

read -r -s -p "Password: " PWD_; echo
[ -n "$PWD_" ] || { echo "Password tidak boleh kosong."; exit 1; }

read -r -p "Router memakai sertifikat sendiri? Lewati verifikasi TLS? [Y/n]: " LONGGAR
LONGGAR="${LONGGAR:-Y}"
if [[ "$LONGGAR" =~ ^[Yy] ]]; then INSECURE="true"; K="-k"; else INSECURE="false"; K=""; fi

echo
echo "Menguji ke $URL/rest/ppp/active …"
KODE=$(curl -s $K -o /tmp/mt-uji.json -m 15 -w "%{http_code}" \
  -u "$USR:$PWD_" -H "Accept: application/json" "$URL/rest/ppp/active" || echo "000")

case "$KODE" in
  200)
    N=$(python3 -c "import json;print(len(json.load(open('/tmp/mt-uji.json'))))" 2>/dev/null || echo "?")
    echo "  OK — router menjawab, $N sesi PPPoE aktif terbaca."
    ;;
  401) echo "  DITOLAK: username/password salah. Tidak ada yang disimpan."; rm -f /tmp/mt-uji.json; exit 1 ;;
  000) echo "  TIDAK TERSAMBUNG: alamat salah, router tidak terjangkau, atau sertifikat ditolak."
       echo "  (kalau sertifikatnya milik router sendiri, jawab Y pada pertanyaan TLS)"; exit 1 ;;
  *)   echo "  Router menjawab HTTP $KODE — belum disimpan."; rm -f /tmp/mt-uji.json; exit 1 ;;
esac
rm -f /tmp/mt-uji.json

# Baru disimpan setelah terbukti bisa dipakai.
cp "$ENV_FILE" "$HOME/backups/noc-portal/$(basename "$ENV_FILE").sebelum-mikrotik-$(date +%F-%H%M)" 2>/dev/null || true
tulis() {  # tulis(nama, nilai) — ganti bila ada, tambah bila belum
  local n="$1" v="$2"
  if grep -q "^${n}=" "$ENV_FILE"; then
    python3 - "$ENV_FILE" "$n" "$v" <<'PY'
import io,sys
p,n,v=sys.argv[1],sys.argv[2],sys.argv[3]
baris=io.open(p,encoding="utf-8").read().split("\n")
io.open(p,"w",encoding="utf-8").write("\n".join(f"{n}={v}" if b.startswith(n+"=") else b for b in baris))
PY
  else
    printf '%s=%s\n' "$n" "$v" >> "$ENV_FILE"
  fi
}

grep -q "^# Kredensial MikroTik" "$ENV_FILE" || {
  printf '\n# Kredensial MikroTik — penarikan sesi PPPoE (BACA-SAJA: hanya GET /rest/ppp/active).\n' >> "$ENV_FILE"
}
tulis MIKROTIK_URL "$URL"
tulis MIKROTIK_USER "$USR"
tulis MIKROTIK_PASSWORD "$PWD_"
tulis MIKROTIK_INSECURE_TLS "$INSECURE"
chmod 600 "$ENV_FILE"

echo "  Disimpan ke $ENV_FILE (izin 600)."
echo
echo "Menyalakan ulang worker supaya env terbaru terbaca…"
pm2 restart perumnet-noc-worker --update-env >/dev/null 2>&1 || echo "  (pm2 tidak ditemukan — jalankan sendiri)"
echo
echo "Selesai. Tugas pppoe.poll akan menarik sesi pada putaran berikutnya (≤60 detik)."
echo "Periksa dengan:"
echo "  docker exec perumnet-noc-postgres psql -U perumnet_noc -d perumnet_noc \\"
echo "    -c \"SELECT status, session_count, error FROM pppoe_poll_runs ORDER BY started_at DESC LIMIT 3\""
