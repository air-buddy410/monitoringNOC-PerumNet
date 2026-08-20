# PerumNet Frontend Design System

Dokumen ini adalah acuan visual dan interaksi untuk aplikasi operasional PerumNet, seperti CRM, NOC monitoring, portal internal, atau aplikasi dashboard lain.

Terapkan aturan ini sebagai sistem presentasi. Jangan mengubah route, RBAC, autentikasi, API, database, server action, atau aturan bisnis aplikasi tujuan kecuali ada instruksi terpisah.

## Identitas Brand

- Font utama: `Arial, Helvetica, sans-serif`.
- Gunakan asset resmi berikut, jangan membuat ulang logo dengan teks atau SVG buatan:
  - `/brand/perumnet-mark.png` untuk mark rumah/Wi-Fi.
  - `/brand/perumnet-wordmark.png` untuk wordmark horizontal.
  - `/favicon.ico`, `/apple-icon.png`, serta manifest aplikasi untuk icon perangkat.
- Warna utama: teal `#04A99F`.
- Gaya visual: rapi, ringan, profesional, bernuansa mint lembut; hindari gradien dekoratif yang berlebihan dan hindari login dua-panel dengan hero besar.

## Token Visual

| Token | Nilai | Penggunaan |
| --- | --- | --- |
| `--pn-primary` | `#04A99F` | CTA, status aktif, fokus |
| `--pn-primary-hover` | `#008F87` | Hover CTA |
| `--pn-sidebar-start` | `#334B4D` | Atas sidebar |
| `--pn-sidebar-end` | `#26383B` | Bawah sidebar |
| `--pn-heading` | `#33484A` | Judul |
| `--pn-body` | `#718185` | Subtitle dan teks sekunder |
| `--pn-border` | `#E0EBE8` | Border kartu dan form |
| `--pn-mint-surface` | `#E4F7F5` | Latar ikon dan status ringan |
| `--pn-canvas-start` | `#F7FBFA` | Latar utama |
| `--pn-canvas-end` | `#EDF7F5` | Latar utama |

## Login

### Struktur

1. Halaman memenuhi viewport dengan `min-height: 100dvh`.
2. Satu wrapper di tengah halaman, maksimum `400px`.
3. Lockup logo di atas kartu: mark rumah/Wi-Fi, wordmark horizontal, lalu label produk.
4. Satu kartu putih berisi ikon, judul, subtitle, dan form.
5. Footer copyright berada di bawah kartu.

### Ukuran dan Spacing

| Elemen | Aturan |
| --- | --- |
| Padding halaman desktop | `28px 18px` |
| Lebar wrapper | `width: min(100%, 400px)` |
| Mark logo | `56 × 56px` |
| Wordmark | tinggi `25px`, lebar otomatis |
| Gap mark dan wordmark | `8px` |
| Gap pada lockup ke label produk | `10px` |
| Jarak brand ke kartu | `24px` |
| Kartu | padding `28px`, radius `15px` |
| Ikon login | `42 × 42px`, radius `10px` |
| Ikon dalam kotak | `21 × 21px` |
| Jarak ikon ke judul | `17px` |
| Judul | `21px`, weight `800`, letter-spacing `-.55px` |
| Subtitle | `13px`, margin `6px 0 21px` |
| Gap antar field | `15px` |
| Label field | `12px`, weight `800` |
| Input | tinggi `43px`, radius `8px` |
| Tombol submit | tinggi `42px`, radius `8px` |
| Footer | margin-top `19px`, ukuran `11px` |

### Gaya

```css
.pn-login-page {
  display: grid;
  min-height: 100dvh;
  place-items: center;
  padding: 28px 18px;
  background:
    radial-gradient(circle at 22% 13%, #e5f8f5 0, transparent 28%),
    linear-gradient(135deg, #f7fbfa 0%, #edf7f5 100%);
}

.pn-login-card {
  padding: 28px;
  background: #fff;
  border: 1px solid #dfece9;
  border-radius: 15px;
  box-shadow: 0 18px 46px #25413a16;
}
```

### Aturan Perilaku

- Field fokus memakai border teal dan focus ring `0 0 0 3px #04a99f1c`.
- Tombol utama berwarna `#04A99F`, berubah menjadi `#008F87` ketika hover.
- Tetap gunakan mekanisme autentikasi aplikasi yang sudah ada; desain tidak boleh membuat kredensial demo, bypass login, atau mengubah redirect.
- Jangan menambahkan link daftar akun atau kredensial demo kecuali memang diwajibkan oleh produk.

## Dashboard Shell

### Desktop

| Elemen | Aturan |
| --- | --- |
| Sidebar | fixed, lebar `264px`, tinggi viewport |
| Latar sidebar | `linear-gradient(180deg, #334B4D 0%, #26383B 100%)` |
| Workspace | `margin-left: 264px` |
| Topbar | putih, sticky, minimum tinggi `64px` |
| Padding topbar | `0 clamp(20px, 3.2vw, 46px)` |
| Padding halaman | `clamp(23px, 3.2vw, 44px)` |
| Kartu | putih, border `#E0EBE8`, radius `12px` |
| Shadow kartu | `0 5px 16px #25413a0a` |

### Sidebar

- Brand header: mark `34 × 40px`, wordmark lebar sekitar `116px`, label produk kecil seperti `NOC` di kanan dengan separator vertikal.
- Link menu: minimum tinggi `45px`, padding horizontal `12px`, radius `9px`, gap ikon/teks `12px`.
- Icon menu: `19px`, stroke tipis.
- Menu aktif: gradient `#06B1A7` ke `#008D85`, teks putih, shadow `0 10px 24px #003f3a38`.
- Footer sidebar: avatar `34 × 34px`, nama dan email user, serta link profil.

### Topbar dan Account Menu

- Topbar menampilkan breadcrumb, pencarian, status live, action ringkas, dan account control di sisi kanan.
- Profile toggle: teks `12px`, weight `700`; icon profil `21px` di atas mint surface.
- Dropdown profile: lebar `184px`, padding `5px`, border radius `10px`, shadow `0 16px 36px #2544431f`.
- Dropdown harus tertutup ketika Escape ditekan, pointer berada di luar menu, atau pengguna berpindah halaman.
- Logout harus tetap memakai form/server action/handler autentikasi asli dari project tujuan.

## Komponen Konten

- Judul halaman: `25px–34px`, weight `800`, warna `#33484A`, line-height sekitar `1.14`.
- Subjudul halaman: `14px`, warna `#718185`.
- Kartu metrik: minimum tinggi `116px`, padding `18px`, gap `15px`.
- Ikon kartu: `48 × 48px`, radius `11px`, mint surface.
- Tabel desktop harus mempertahankan data utuh; bila ruang tidak cukup, gunakan container horizontal-scroll, bukan memotong kolom penting.

## Responsive

| Breakpoint | Aturan |
| --- | --- |
| Desktop `>820px` | Sidebar fixed terlihat, topbar `64px` |
| Tablet `≤820px` | Sidebar menjadi drawer overlay, workspace tanpa margin kiri, topbar sticky minimum `59px` |
| Mobile `≤580px` | Padding halaman `23px 18px 32px`, search disembunyikan, teks breadcrumb diringkas, action sekunder boleh disembunyikan |

### Drawer Tablet dan Mobile

- Drawer sidebar tetap lebar `264px`.
- Saat tertutup: `transform: translateX(-100%)`.
- Saat terbuka: `transform: translateX(0)` dengan transisi maksimal `240ms`.
- Backdrop menutupi layar di bawah drawer dan menutup drawer saat diketuk.
- Kunci scroll body ketika drawer terbuka.
- Tutup drawer setelah pengguna memilih navigasi.
- Tombol menu minimum `38 × 38px`, `touch-action: manipulation`, dan harus berada di atas konten.

### Login Mobile

Pada `≤580px`:

- Padding halaman: `22px 18px`.
- Padding kartu: `24px 22px`.
- Wrapper tetap maksimum `400px` dan tidak boleh overflow horizontal.

## Aksesibilitas dan Motion

- Semua action icon wajib memiliki `aria-label`.
- Gunakan focus ring yang terlihat pada input, tombol, dan profile toggle.
- Target sentuh minimum `38 × 38px` untuk kontrol mobile.
- Hormati `prefers-reduced-motion`: hilangkan transisi sidebar dan gerak hover yang tidak penting.
- Jangan mengandalkan warna saja untuk membedakan status perangkat atau alert.

## Checklist Implementasi

- [x] Menggunakan mark, wordmark, favicon, dan app icon resmi PerumNet.
- [x] Login satu-kartu terpusat, bukan desain dua-panel.
- [x] Lebar login maksimum `400px`.
- [x] Sidebar desktop `264px` dan dark-teal gradient.
- [x] Tablet/mobile memakai drawer yang benar-benar dapat dibuka dan ditutup.
- [x] Topbar sticky pada viewport tablet/mobile.
- [x] Profile menu dapat ditutup dengan Escape dan klik luar.
- [x] Tidak ada horizontal overflow di mobile.
- [x] Tidak ada perubahan pada backend, API, RBAC, atau autentikasi tanpa instruksi eksplisit.
- [x] Diuji secara visual pada desktop, tablet, dan mobile; cek juga console browser.

## Instruksi Singkat untuk AI Implementer

> Terapkan `docs/PERUMNET_FRONTEND_DESIGN_SYSTEM.md` sebagai source of truth untuk tampilan dan interaksi frontend. Pertahankan semua route, RBAC, autentikasi, server action, API, database, dan aturan bisnis yang telah ada. Gunakan asset brand PerumNet yang tersedia, jangan menggambar ulang logo. Implementasikan login satu-kartu berlebar maksimal 400px, sidebar desktop 264px, topbar putih, dan drawer overlay responsif. Verifikasi pada desktop, tablet, dan mobile tanpa browser error atau horizontal overflow.
