# Sumber data lapangan — apa yang ada, di mana, dan bentuknya

Tanggal: 22 Agustus 2026

Ditulis karena modul fiber (Fase 11–14) sudah berdiri lengkap sementara
produksi masih **0 OTB, 0 kabel, 0 closure**. Empat fase backend dan enam
layar belum pernah bertemu satu pun data nyata, dan dokumen ini mencatat di
mana data itu sebenarnya berada.

**CRM tidak diubah oleh dokumen ini.** Yang ada di sini salinan dan catatan
untuk dipakai portal NOC.

---

## 1. Yang sudah masuk portal NOC

Lewat `npm run impor:crm` (baca-saja terhadap CRM, idempoten):

| Data | Jumlah |
|---|---|
| ODP | 577 — 63 di antaranya berperan `MS` (master splitter) |
| Port ODP | 8.632 |
| Pelanggan per ODP | 1.687 (tanpa identitas — hanya `pppoe_username`) |
| OLT | 6 |
| Situs | 6 |
| Sesi PPPoE | ±1.611, ditarik worker tiap ±2 menit |

Ini cukup untuk menguji Fase 12–14 **sebagian**: terminasi ke port ODP dan
port master splitter sudah punya sasaran nyata. Yang belum punya sumber sama
sekali: OTB, kabel, core, dan closure.

## 2. Yang masih di Google Drive, belum pernah masuk mana pun

Tercatat di `crm/docs/TEMUAN-DATA-BENTROK.md` (15 Agustus 2026). Sumbernya:

- `Salinan dari Items`
- `Salinan dari 2026 Master Data Perumnet`
- **`Salinan dari Alokasi Core`** ← yang kita butuhkan
- data PPPoE langsung dari router distribusi

### Tab `Alokasi Core 144`

Splice matrix backbone yang dikerjakan **manual di spreadsheet**:

- Segment **Kecicang–Pesagi**
- **144 core, 12 tube**, warna standar G.652
- Tiap core punya **next-hop**
- Sebagian menuju port PON OLT langsung (mis. `C600 1/17/6`)

Statusnya di CRM: *"Belum diimpor — model fiber belum dibangun."* **Model itu
sekarang ada** — `fiber_cable_segments`, `fiber_cores`, `fiber_closures`,
`fiber_core_splices` (Fase 12–13), di portal ini.

### Dua kesalahan yang sudah diketahui ada di sheet itu

- **`TUBE 5 - CORE 5` muncul dua kali** (FO ID 52 dan 53); satunya semestinya
  `CORE 4`.
- Urutan `TUBE 6` melompat: `CORE 6` di FO ID 64, `CORE 5` di 65.

Catatan CRM menyebut nomor core ganda dalam satu tube **seharusnya ditolak
constraint database**. Itu benar — dan lihat §4 di bawah, karena model kita
belum bisa menolaknya.

---

## 3. Alamat OLT: dokumen benar, database tidak

`OPERATIONS.md` §11.2 mencatat sejak 20 Agustus bahwa lima dari enam OLT
terdaftar dengan `172.30.10.6` — jalur port-forwarding ALUS yang tidak
terjangkau dari VPS — dan menuliskan alamat penggantinya.

**Perbaikan itu tidak pernah masuk database mana pun.** Diuji ulang 22
Agustus dari VPS:

| Alamat | Hasil |
|---|---|
| `172.30.10.6` port 23, 231, 1024 | **tidak satu pun menjawab** |
| `192.168.100.10:1023` … `.61:23` | **keenamnya menjawab** |

Keadaan basis data pada tanggal itu: CRM `OltDevice` dan NOC `olt_devices`
sama-sama masih memakai alamat lama. NOC menyalinnya dari CRM lewat
`impor:crm`, jadi memperbaiki NOC saja akan **tertimpa lagi** pada impor
berikutnya — importir menulis `management_ip` dan `telnet_port` apa adanya.

Akibat nyata: **fitur konsol perangkat gagal untuk 5 dari 6 OLT**, dan
gagalnya berupa waktu-habis, bukan pesan yang menjelaskan.

Alamat yang terbukti menjawab disimpan di `docs/referensi/nama-olt.json`.

---

## 4. Lubang di model kita yang baru terlihat karena data ini

`fiber_cores` menyimpan **satu** penomoran: `core_number`, unik per segmen,
dengan `tube_number` sebagai kolom biasa tanpa constraint.

Sheet memakai **dua**: FO ID global 1–144, **dan** posisi core di dalam tube.
Kalau diimpor dengan `core_number` = FO ID, dua baris yang sama-sama berlabel
`TUBE 5 CORE 5` punya FO ID 52 dan 53 — berbeda, jadi **lolos**. Constraint
kita tidak akan menolak justru kesalahan yang catatan CRM sebut sebagai
alasan terkuat memindahkan data ini keluar dari spreadsheet.

Perbaikannya aditif dan kecil:

```
ALTER TABLE fiber_cores ADD COLUMN core_in_tube integer;
CREATE UNIQUE INDEX fiber_cores_tube_pos_idx
  ON fiber_cores (segment_id, tube_number, core_in_tube)
  WHERE tube_number IS NOT NULL;
```

Parsial, supaya kabel tanpa tabung tetap sah.

**Ini alasan memuat data nyata sebelum menambah fase.** Empat fase lolos 559
tes, dan tetap ada bentuk data lapangan yang tidak bisa diwakilinya — dan itu
ketahuan dari satu paragraf dokumen, bukan dari telaah ulang skema.

---

## 5. Yang dibutuhkan untuk melanjutkan

1. Ekspor tab **`Alokasi Core 144`** (CSV/XLSX) ditaruh di mesin ini.
2. Tambah `core_in_tube` beserta constraint-nya (§4).
3. Tulis importir, jalankan terhadap data asli **tanpa memperbaiki sheet**.
4. Pastikan kedua kesalahan di §2 benar-benar ditolak database — bukan
   diperbaiki diam-diam oleh importir.

Langkah 4 itu ukurannya. Importir yang membereskan data buruk tanpa
mengeluh menghasilkan database yang tampak rapi dan tidak bisa dipercaya.
