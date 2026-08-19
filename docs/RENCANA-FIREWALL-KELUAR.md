# Rencana firewall keluar — untuk dijalankan pemilik VPS

`docs/MODE-BACA-SAJA.md` §Yang TIDAK dijamin butir 2 menyebut bahwa jaminan
sesungguhnya bukan uji penyisir sumber (itu grep, bukan sandbox) melainkan
aturan firewall keluar di VPS. Berkas ini menjabarkannya.

**Saya tidak bisa menjalankannya sendiri.** `sudo -n true` di
`perumnet@perumnet.tail7f7461.ts.net` menuntut autentikasi interaktif, jadi
seluruh langkah di bawah harus dijalankan pemilik.

## Kabar buruk lebih dulu: rencana awalnya tidak jalan

Gagasan "batasi lalu lintas keluar milik user aplikasi" **tidak bisa dipakai apa
adanya di sini**. Diperiksa 19 Agustus 2026: **keenam proses PM2 berjalan sebagai
user yang sama, `perumnet`** —

```
perumnet-noc            perumnet-enterprise-admin    perumnet-warehouse
perumnet-captive        perumnet-enterprise-demo     perumnet-enterprise-email-worker
```

Aturan `meta skuid` per-user karena itu tidak bisa membedakan NOC dari yang
lain. Menerapkannya akan ikut memutus SMTP enterprise dan email worker — dan
CRM yang berjalan sebagai Docker punya jalurnya sendiri lagi.

## Dua jalan yang benar-benar bisa

### A. User Unix sendiri untuk NOC, lalu saring per-user *(disarankan)*

Paling tepat sasaran, dan satu-satunya yang benar-benar mengisolasi NOC.

1. `useradd -r -m -d /home/noc-app noc-app`
2. Pindahkan `~/apps/noc-portal` ke user itu (`chown -R`), termasuk `.next`,
   `node_modules`, dan `.env.production` (**tetap `chmod 600`**).
3. Daftarkan ulang di PM2 milik user itu — bukan di PM2 `perumnet`. Ingat
   interpreter `node-v22`; node sistem masih v20.
4. Baru aturan nft di bawah, dengan `meta skuid noc-app`.

Biayanya nyata: satu proses PM2 pindah rumah, dan `pm2 resurrect` saat reboot
harus disiapkan untuk user baru itu juga. Kerjakan saat tidak ada yang memakai
portal.

### B. Allowlist per-tujuan untuk seluruh host *(lebih murah, kurang tajam)*

Tidak memisahkan NOC dari app lain, tapi tetap menutup "aplikasi mana pun
tiba-tiba menghubungi Telegram/WhatsApp/CRM luar". Harus memuat kebutuhan
SEMUA app, jadi daftarnya lebih panjang dan lebih mudah salah.

## Tujuan keluar yang sah (per 19 Agustus 2026)

| Tujuan | Untuk apa |
|---|---|
| `127.0.0.1:8000` | LibreNMS, di host yang sama |
| `100.65.248.6:993` | IMAP mailcow (`perumnet-mail`), login satu pintu |
| `100.64.0.0/10` + UDP 41641 | Tailscale — **jalur SSH kita sendiri** |
| DNS (53), NTP (123) | dasar |
| `103.187.113.225:8444` | MikroTik distribusi (worker CRM) |

Yang **tidak** ada di daftar itulah yang jadi tujuan latihan ini:
`api.telegram.org`, gateway WhatsApp, dan endpoint CRM luar.

## Jangan sampai mengunci diri sendiri

SSH ke VPS ini lewat **Tailscale**. Aturan keluar yang salah bisa memutus
Tailscale, dan setelah itu tidak ada jalan masuk selain konsol Proxmox.

Karena itu **jangan pernah** menerapkan ruleset tanpa pembatal otomatis:

```bash
# Pasang pembatal DULU: 5 menit lagi ruleset dikosongkan, apa pun yang terjadi.
sudo systemd-run --on-active=5min --unit=nft-rollback \
  nft flush ruleset

# Baru terapkan aturannya.
sudo nft -f /etc/nftables-egress.conf

# Uji dari MESIN LAIN bahwa SSH & layanan masih hidup. Kalau semua sehat:
sudo systemctl stop nft-rollback     # batalkan pembatalnya
sudo cp /etc/nftables-egress.conf /etc/nftables.conf   # baru dibuat permanen
```

Kalau kamu terkunci, tidak perlu panik: tunggu lima menit.

## Urutan yang saya sarankan

1. Jalan **A** (user Unix sendiri) — tanpa itu, aturan per-user tidak mungkin.
2. Terapkan dengan pembatal otomatis di atas.
3. Uji: portal NOC masih membaca LibreNMS, login masih tembus IMAP, dan
   `curl https://api.telegram.org` dari user `noc-app` **gagal**.
4. Setelah terbukti, catat di `docs/OPERATIONS.md` §9 dan hapus butir 2 dari
   §Yang TIDAK dijamin di `docs/MODE-BACA-SAJA.md`.

## Sampai itu dikerjakan

Yang menahan tetap penjaga di kode (`src/server/outward-guard.ts`) dan uji
penyisir sumber. Keduanya menahan **kode kita sendiri** — bukan dependensi npm
yang berbuat sendiri. Itu batas yang jujur, dan berkas ini ada supaya batas itu
punya jalan keluar, bukan sekadar dicatat.
