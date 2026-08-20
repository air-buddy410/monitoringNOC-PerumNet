# Handoff Backend → Frontend (Opus → Luna)

Kanal satu arah: kontrak yang **sudah siap dipakai** dari sisi backend —
nama fungsi/endpoint, nama field, dan batas perilakunya — supaya frontend
tidak perlu menebak dari kode.

Kanal balik: `docs/PERMINTAAN-FRONTEND-KE-BACKEND.md`.
Aturan lengkap: `docs/WORKFLOW-TIM.md`.

## Format

```
### <nama kontrak>
- **Dipakai untuk:** layar/fitur apa
- **Cara pakai:** nama fungsi atau endpoint + parameter
- **Field:** nama field persis (bukan perkiraan)
- **Batas perilaku:** apa yang ditolak, dan pesan errornya
```

Bentuk payload yang dipakai berulang ditulis sekali di **§Bentuk data
bersama**, lalu dirujuk namanya dari tiap endpoint — supaya nama field hanya
punya satu tempat untuk berubah.

Setiap nama di dokumen ini **wajib diverifikasi langsung dari sumbernya**,
bukan dari ingatan. Isi pertama dokumen ini disusun 2026-08-17 dengan membaca
35 berkas `src/app/api/**/route.ts` beserta tipe payload-nya.

---

## Aturan umum semua endpoint

**Login & peran.** Hampir semua rute dibungkus `withRole([...])` dari
`src/server/rbac.ts`. Sesi diambil dari cookie Better Auth — cukup `fetch`
biasa dari browser, tidak ada header token yang perlu dipasang sendiri.

- Peran yang ada: `admin` · `noc` · `engineer` · `manajemen` (default akun
  baru: `engineer`).
- Belum login → **401** `{ "error": "Belum login." }`
- Peran tidak cukup → **403** `{ "error": "Akses ditolak: butuh peran admin/noc." }`
- `withRole([])` = cukup login, peran apa pun.

**Bentuk error selalu sama:** `{ "error": "kalimat bahasa Indonesia" }`.
Kalimatnya sudah ditulis untuk dibaca pengguna akhir — tampilkan apa adanya,
jangan diterjemahkan ulang di frontend.

**Helper yang sudah ada** (jangan bikin fetcher baru):
`src/lib/api/http.ts` → `getJson<T>(url)`, `sendJson<T>(method, url, body)`,
dan `ApiError` yang membawa `message` (dari `error`) + `status`.

**Dua keluarga endpoint, jangan dicampur:**

| Keluarga | Model data | Status |
|---|---|---|
| `/api/v1/**` | `Asset` (`assetId`, `hostname`, `site`, `networkRole`) | **Pakai ini untuk layar baru.** |
| `/api/devices/**`, `/api/dashboard/**` | `NetworkDevice` (proyeksi lama: `id`, `name`, `area`, `group`) | Warisan UI lama, dipertahankan sampai migrasi Fase 7. Jangan dipakai untuk layar baru. |

`NetworkDevice.id` = `Asset.assetId` — ID-nya sama, hanya nama field dan
kelengkapannya yang beda.

**Cache-Control** sudah diatur di server (10 detik untuk snapshot perangkat,
60 detik untuk histori, 300 detik untuk laporan). Polling di klien tidak perlu
lebih rapat dari itu — di bawah TTL jawabannya identik.

---

## Bentuk data bersama

### `Asset` — `src/types/asset.ts`

```ts
assetId: string            librenmsDeviceId: number | null
hostname: string           displayName: string
managementIp: string       vendor: string
os: string | null          model: string | null
serialNumber: string | null
site: string               location: string | null
latitude: number | null    longitude: number | null
tags: string[]
networkRole: "core" | "distribution" | "access" | "olt" | "server" | "infrastructure"
status: "online" | "warning" | "offline"
crmRef: { customerId?: string; serviceId?: string } | null
```

### `NetworkDevice` (keluarga lama) — `src/types/device.ts`

```ts
id: string       name: string     ip: string
group: "MikroTik" | "Ruijie" | "OLT"
area: string     status: "online" | "warning" | "offline"
latitude: number longitude: number
```

### `IncidentView` — `src/server/api-v1/contracts.ts`

```ts
id: string                 librenmsAlertId: string
assetId: string | null     deviceName: string
severity: "ok" | "warning" | "critical"
state: "open" | "acknowledged" | "resolved"
message: string            triggeredAt: string        // ISO
acknowledgedBy: string | null   acknowledgedAt: string | null
resolutionNote: string | null
```

### `DeviceMetricsSnapshot` — `src/server/metrics-store.ts`

```ts
usage: { time: string; cpu: number; ram: number }[]
temperature: { celsius: number; status: "normal" | "tinggi" | "kritis" }
ports: {
  port: string
  series: { time: string; download: number; upload: number }[]
  currentDownload: number
  currentUpload: number
}[]
updatedAt: string
```

Ambang suhu (`src/lib/mock-metrics.ts`): `tinggi` ≥ 60 °C, `kritis` ≥ 75 °C.
Warna di UI ikut `status`, jangan hitung ulang dari `celsius`.

### `PonPortHealth` (optik OLT)

```ts
port: string      sfpUp: boolean     txPower: number          // dBm
onus: { id: string; rxPower: number; status: "online" | "offline" | "dying_gasp" }[]
```

Ambang Rx Power: `RX_POWER_LOW` = −25 dBm, `RX_POWER_CRITICAL` = −28 dBm.
Makin negatif makin lemah.

### `TopologyDetail`

```ts
topology: { topologyId, name, status: "draft" | "published", version: number, updatedAt }
nodes: { nodeId, assetId, x: number, y: number, label: string | null }[]
links: {
  linkId, sourceNodeId, targetNodeId
  sourcePort: string | null   targetPort: string | null
  mediaType: string | null    capacityMbps: number | null
  direction: "uni" | "bi"     status: "up" | "down" | "unknown"
  note: string | null
}[]
```

---

## Siap dipakai

### 1. Sesi & akun

- **Dipakai untuk:** login, profil, manajemen pengguna.
- **Satu pintu (2026-08-17):** semua login lewat `/api/auth/sign-in/portal`.
  Yang menentukan bagaimana password diperiksa adalah server (`AUTH_PROVIDER`),
  bukan frontend — kirim saja `{ email, password }` dan tangani jawabannya.
  Tidak ada yang perlu dibaca atau ditebak dari sisi klien.
  **Produksi berjalan di `MAILSERVER` sejak 20 Agustus 2026** — password yang
  berlaku adalah password EMAIL mailcow. Tetap jangan menulisnya statis di
  layar: ambil dari `/api/auth-mode`. Keduanya kini menjawab `false`
  (`passwordChangeAvailable`, `passwordRequiredOnCreate`) — dan
  `change-password-form.tsx` serta `user-table.tsx` **sudah** menanganinya
  lewat `useAuthMode()`, jadi tidak ada yang perlu kamu ubah. Diperiksa
  20 Agustus 2026; disebut di sini supaya tidak dikira terlewat.
- **Cara pakai:**
  | Endpoint | Peran | Catatan |
  |---|---|---|
  | **`POST /api/auth/sign-in/portal`** | publik | **satu-satunya pintu masuk.** body `{ email, password }` |
  | ~~`POST /api/auth/sign-in/email`~~ | — | masih hidup di mode LOCAL, **mati** di mode MAILSERVER. Jangan dipakai. |
  | ~~`POST /api/auth/sign-up/email`~~ | — | **ditutup permanen** (`disableSignUp`) — akun hanya dibuat admin |
  | `POST /api/auth/sign-out` · `GET /api/auth/get-session` | login | Better Auth bawaan |
  | `POST /api/auth/update-user` | login | dipakai halaman profil |
  | ~~`POST /api/auth/change-password`~~ | — | **mati di mode MAILSERVER** — password portal tidak ada; yang diganti adalah password email di mailcow |
  | `GET/POST /api/auth/list-sessions` `…/revoke-session` `…/revoke-other-sessions` | login | daftar perangkat aktif |
  | `GET /api/users` | **admin** | `{ users: [{ id, name, email, role, emailVerified, createdAt }], total }`, urut `createdAt` naik |
  | `POST /api/users` | **admin** | body `{ name, email, role?, password? }` → **201** `{ user: { id, name, email, role }, authProvider }` |
  | `PATCH /api/users/:id` | **admin** | body `{ role }` → `{ user: { id, name, email, role } }` |
  | `PATCH /api/profile/email` | login | body `{ email }` → `{ user: { id, name, email } }`. **403 di mode MAILSERVER** — lihat T-16 |
  | **`GET /api/auth-mode`** | publik | `{ provider, passwordChangeAvailable, passwordRequiredOnCreate, emailChangeAvailable }` — sumber kebenaran untuk merender form |
- **Batas perilaku:**
  - `POST /api/users`: nama wajib ≤ 80 karakter, email harus valid, `role`
    harus salah satu dari empat peran. Email sudah terpakai → **409**
    `Email x@y sudah terdaftar.`
  - **`password` tergantung mode**, dan responsnya menyebutkan mode yang aktif
    lewat field `authProvider`:
    - `MAILSERVER` → password **tidak dipakai**, dan mengirimnya ditolak
      **400**: *"Mode mailserver: akun memakai password email dari mailcow…"*.
      Sembunyikan isian password saat mode ini.
    - `LOCAL` → password wajib, minimal 8 karakter.
  - `PATCH /api/users/:id`: **admin terakhir tidak bisa diturunkan** → **409**
    `Tidak bisa menurunkan admin terakhir.` Tombol turunkan-peran harus siap
    menerima penolakan ini, bukan disembunyikan berdasarkan tebakan klien.
  - `PATCH /api/profile/email`: email dipakai akun lain → **409**. Ganti email
    **mereset `emailVerified` jadi `false`** — tampilkan konsekuensinya.

### 2. Aset & ringkasan — `/api/v1`

- **Dipakai untuk:** dasbor Big Numbers, daftar/inventaris aset, detail aset.
- **Cara pakai:**
  | Endpoint | Peran | Respons |
  |---|---|---|
  | `GET /api/v1/overview` | login | `{ totals: { total, online, warning, offline }, updatedAt }` |
  | `GET /api/v1/assets?site=&vendor=&role=&status=&q=` | login | `{ assets: Asset[], total, updatedAt }` |
  | `GET /api/v1/assets/:assetId` | login | `{ asset: Asset, updatedAt }` |
  | `GET /api/v1/assets/:assetId/graph?type=&from=&to=&width=&height=` | login | **PNG**, bukan JSON |
- **Batas perilaku:**
  - `total` pada daftar aset = **jumlah sebelum filter** (untuk teks "12 dari
    80"), sedangkan `assets` sudah tersaring.
  - `q` mencari di `displayName`, `hostname`, dan `managementIp`.
  - Nilai `site`/`vendor` yang tidak dikenal ditolak **400**
    (`Site tidak dikenal: X`) — isi kontrol filter dari nilai yang benar-benar
    ada di data, jangan diketik bebas.
  - Grafik: `type` hanya `device_bits` (default), `device_processor`,
    `device_mempool`, `device_uptime`, `device_ping_perf`. `from` default
    `-24h`. `width` dijepit 200–1600 (default 900), `height` 100–800 (default
    300). Aset tanpa `librenmsDeviceId` → **404** dengan pesan "belum
    dipetakan ke LibreNMS"; LibreNMS bermasalah → **502**. Token LibreNMS
    tidak pernah sampai ke browser — pasang `<img src>` ke endpoint ini.

### 3. Incident — `/api/v1`

- **Dipakai untuk:** panel aktivitas jaringan, lonceng notifikasi, tombol ack.
- **Cara pakai:**
  - `GET /api/v1/incidents?state=&severity=&limit=` (login) →
    `{ incidents: IncidentView[], total }`
  - `POST /api/v1/incidents/:alertId/acknowledge` (**admin/noc/engineer**),
    body opsional `{ note }` → `{ incident: IncidentView }`
- **Batas perilaku:**
  - `state` ∈ `open|acknowledged|resolved`, `severity` ∈ `ok|warning|critical`,
    `limit` bilangan bulat **1–200** (default 50). Di luar itu **400**.
  - `:alertId` menerima **ID internal incident maupun `librenmsAlertId`** —
    keduanya bekerja.
  - `note` maksimal **500 karakter** → lebih dari itu **400**.
  - Incident yang sudah `resolved` tidak bisa di-ack → **409**.
  - Tanpa body sama sekali = ack tanpa catatan (bukan error).

### 4. Topologi — `/api/v1`

- **Dipakai untuk:** kanvas topologi, panel usulan discovery.
- **Cara pakai:**
  | Endpoint | Peran | Respons |
  |---|---|---|
  | `GET /api/v1/topologies` | admin/noc/engineer | `{ topologies: TopologySummary[], total }` |
  | `POST /api/v1/topologies` | **admin/engineer** | body `{ name }` → **201** `{ detail }` |
  | `GET /api/v1/topologies/:id` | admin/noc/engineer | `{ detail }` |
  | `PATCH /api/v1/topologies/:id` | **admin/engineer** | body `{ name?, actions? }` → `{ detail }` |
  | `POST /api/v1/topologies/:id/publish` | **admin/engineer** | `{ topology: TopologySummary }` |
  | `POST /api/v1/topologies/:id/discovery` | **admin/engineer** | `{ discovered, suggested, failedDevices, ranAt, suggestions }` |
  | `POST /api/v1/topologies/:id/discovery/:suggestionId/review` | **admin/engineer** | body `{ state: "accepted" \| "rejected" }` → `{ suggestion }` |
- **Field `detail`:** lihat `TopologyDetail` di atas — perhatikan bungkusnya
  **`{ detail: { topology, nodes, links } }`**, bukan `{ topology, nodes, links }`
  langsung.
- **Batas perilaku:**
  - Nama topologi wajib, maksimal **120 karakter**.
  - `PATCH` tanpa `name` maupun `actions` → **400** `Tidak ada perubahan
    (name/actions).`
  - **Seluruh `actions` dijalankan dalam satu transaksi** — satu aksi gagal,
    semuanya batal dan tidak ada yang tersimpan. Jadi kirim satu batch per
    gestur pengguna, dan kembalikan kanvas ke `detail` dari respons, bukan ke
    state optimistis klien.
  - Aksi yang tersedia: `addNode`, `moveNode`, `removeNode`, `addLink`,
    `updateLink`, `removeLink` (bentuk persisnya di `contracts.ts`).
  - Discovery **tidak pernah mengubah node/link yang sudah ada** — hasilnya
    selalu usulan `pending` sampai di-review. `accepted` langsung digabungkan,
    `rejected` hanya menutup usulan.
  - `publish` membuat versi baru; draft tetap ada. Operasional membaca versi
    published terakhir.

### 5. Perangkat — keluarga lama

- **Dipakai untuk:** wallboard NOC, peta, halaman detail perangkat lama.
  Hanya untuk layar yang sudah ada; layar baru pakai `/api/v1`.
- **Cara pakai:** semua perlu login kecuali yang ditandai.
  | Endpoint | Respons |
  |---|---|
  | `GET /api/devices?area=&group=&status=&q=&sort=` | `{ devices: NetworkDevice[], total, updatedAt }` |
  | `GET /api/devices/meta` | `{ areas: string[], groups: DeviceGroup[] }` — isi kontrol filter dari sini |
  | `GET /api/devices/geo` | GeoJSON `FeatureCollection`, koordinat **`[lng, lat]`** (WGS84), `properties: { id, name, ip, group, area, status }` |
  | `GET /api/devices/:id/live` | `{ device, metrics, optics, updatedAt }` — **satu permintaan per siklus polling 10 detik** |
  | `GET /api/devices/:id/metrics` | `DeviceMetricsSnapshot` |
  | `GET /api/devices/:id/metrics-history?metric=&hours=` | `{ metric, hours, points: [{ time, value }], updatedAt }` |
  | `GET /api/devices/:id/olt-optics` | `{ ports: PonPortHealth[], updatedAt }` |
  | `GET /api/dashboard/summary` | `{ total, online, warning, offline, updatedAt }` — **tanpa pemeriksaan login** |
- **Batas perilaku:**
  - `area`, `group`, `status` menerima nilai `"all"` sebagai "tanpa filter";
    nilai lain yang tidak dikenal → **400**. `sort` hanya `severity`
    (bermasalah dulu) atau `name`.
  - `total` = jumlah **sebelum** filter.
  - `metrics-history`: `metric` ∈ `cpu|ram|suhu|bandwidth` (default `cpu`),
    `hours` 1–720 (default 24).
  - `olt-optics` menolak perangkat non-OLT → **400** `Perangkat X bukan OLT —
    data optik tidak tersedia.` Panggil hanya kalau `group === "OLT"`.
  - `/live` sudah menggabungkan device + metrics + optics; **jangan** panggil
    `/metrics` dan `/olt-optics` terpisah di halaman yang sama.

### 6. Notifikasi

- **Dipakai untuk:** halaman channel bot dan riwayat alert.
- **Cara pakai:**
  | Endpoint | Peran | Respons |
  |---|---|---|
  | `GET /api/notifications/channels` | login | `{ channels: [{ id, type, recipientName, target, verified, active, createdAt }], total }` |
  | `POST /api/notifications/channels` | login | body `{ type, recipientName, target }` → **201** `{ channel, verificationCode }` |
  | `POST /api/notifications/channels/verify` | **publik (dipanggil bot)** | body `{ code, chatId }` → `{ channel }` |
  | `GET /api/notifications/logs?q=&channel=&status=&limit=&offset=` | login | `{ logs, total, limit, offset }` |
  | `GET /api/notifications/logs/:id` | login | `{ log }` |
  | `PATCH /api/notifications/logs/:id` | login | body `{ resolutionNote }` → `{ log }` |
- **Field `log`:** `id`, `librenmsAlertId`, `deviceName`,
  `alertType` (`telegram|whatsapp`), `messageContent`,
  `status` (`sent|failed`), `resolutionNote` (nullable), `triggeredAt`.
- **Batas perilaku:**
  - `type` hanya `telegram` atau `whatsapp`. Pasangan (`type`, `target`) yang
    sudah ada → **409** `Target X (telegram) sudah terdaftar.`
  - `verificationCode` **6 digit** hanya dikembalikan sekali, saat pendaftaran
    — tampilkan agar pengguna mengirimkannya ke bot. Channel baru berstatus
    `verified: false, active: false` sampai bot memanggil `/verify`.
  - Log: `limit` 1–200 (default 50), `offset` ≥ 0, `total` = jumlah baris yang
    cocok filter **tanpa** paginasi. Urutan terbaru dulu, penyaringan di SQL.
  - `resolutionNote` wajib string; **string kosong menghapus catatan** (jadi
    `null`), bukan menyimpan string kosong.

### 7. Laporan

- **Dipakai untuk:** halaman laporan SLA & trafik, tombol ekspor.
- **Cara pakai:**
  | Endpoint | Peran | Respons |
  |---|---|---|
  | `GET /api/reports/sla?period=YYYY-MM` | **tanpa pemeriksaan login** | `{ period, targetPercent, rows, summary }` |
  | `GET /api/reports/traffic?period=YYYY-MM` | **tanpa pemeriksaan login** | `{ period, rows, summary }` |
  | `GET /api/reports/traffic?from=YYYY-MM&to=YYYY-MM` | idem | agregasi rentang |
  | `GET /api/reports/export/excel?type=&period=` | **admin/manajemen** | berkas `.xlsx` |
  | `GET /api/reports/export/pdf?type=&period=` | **admin/manajemen** | berkas `.pdf` |
- **Field:**
  - SLA `rows[]`: `deviceId`, `deviceName`, `group`, `area`, `uptimePercent`,
    `downtimeMinutes`, `incidents`, `meetsTarget`. Urut **uptime terendah
    dulu**. `targetPercent` = **99.5**; `summary` = `{ devices, averageUptime,
    belowTarget }`.
  - Trafik `rows[]`: `deviceId`, `deviceName`, `group`, `area`, **`downloadGb`,
    `uploadGb`** (huruf b kecil), `avgMbps`, `peakMbps`. Urut download
    terbesar dulu. `summary` = `{ devices, totalDownloadGb, totalUploadGb }`.
- **Batas perilaku:**
  - `period` wajib `YYYY-MM` → salah format **400** `period wajib berformat
    YYYY-MM, mis. 2026-07.`
  - Rentang: `from` tidak boleh setelah `to`, maksimal **12 bulan**.
  - `type` ekspor hanya `sla` atau `traffic`. Ekspor **tercatat di audit**
    (`sla_reports`) dengan ID pengguna — bukan operasi diam-diam.
  - Ekspor mengembalikan berkas dengan `Content-Disposition: attachment`
    (`laporan-<type>-<period>.xlsx|pdf`) — arahkan `window.location` atau
    tautan biasa, jangan `getJson`.

### 8. Integrasi & portal pelanggan

- **Cara pakai:**
  | Endpoint | Peran | Untuk |
  |---|---|---|
  | `GET /api/v1/integrations/librenms/status` | **admin** | diagnostik koneksi |
  | `POST /api/v1/integrations/librenms/alerts` | webhook LibreNMS | ingress alert, **bukan untuk frontend** |
  | `GET /api/v1/integrations/crm/service-mappings` | **admin** | `{ mappings, total }` |
  | `POST /api/v1/integrations/crm/service-mappings` | **admin** | body `{ externalCustomerId, externalServiceId, assetId?, librenmsGroup? }` |
  | `GET /api/v1/customer/services/:serviceId/status?customerId=&token=` | **publik ber-token** | status untuk pelanggan |
- **Field:**
  - Status LibreNMS: `configured`, `reachable`, `lastError`, `deviceCount`,
    `alertCount`, `assetCount`, `mappedAssetCount`,
    `snapshotSource` (`"librenms" | "fixture"`), `checkedAt`.
  - Mapping CRM: `mappingId`, `externalCustomerId`, `externalServiceId`,
    `assetId`, `librenmsGroup`, `syncStatus` (`active|pending|error`),
    `updatedAt`. Upsert idempoten per (`externalCustomerId`,
    `externalServiceId`) → **201** kalau baru, **200** kalau memperbarui.
  - Status pelanggan: `serviceId`, `status` (`up|degraded|down|maintenance`),
    `activeIncident: { startedAt, message } | null`,
    `history: [{ occurredAt, durationMinutes, summary }]`, `supportContact`.
- **Batas perilaku:**
  - Halaman pelanggan **tidak pernah** menerima data internal — tidak ada
    hostname, IP manajemen, topologi, atau metrik. Jangan minta tambahan yang
    membocorkannya.
  - `token` = HMAC dari `CUSTOMER_PORTAL_SECRET`; token salah/kedaluwarsa →
    **401** `Tautan tidak valid atau kedaluwarsa.` Parameter kurang → **400**,
    layanan tidak ada → **404**.
  - `snapshotSource: "fixture"` berarti seluruh angka di layar sedang berasal
    dari data tiruan (lihat bagian berikut) — layar diagnostik sebaiknya
    menyatakannya terang-terangan.

### 9. Mode baca-saja — `GET /api/read-only-mode`

- **Dipakai untuk:** penanda "mode baca-saja" di shell aplikasi.
- **Cara pakai:** `GET /api/read-only-mode` — **cukup login**, peran apa pun.
  Tidak perlu di-poll: nilainya hanya berubah kalau konfigurasi server berubah
  dan servernya di-restart. Perlakukan seperti `GET /api/auth-mode`.
- **Field:**
  - `readOnly`: `boolean`
  - `outwardActions`: `"BLOCKED"` | `"ALLOWED"`
  - `configured`: `{ "crm-webhook": boolean, telegram: boolean, whatsapp: boolean }`
    — kanal yang AKAN bertindak keluar SEANDAINYA modenya `ALLOWED`. Ini
    **bukan** status pengiriman; `true` di sini tidak berarti ada yang terkirim.
  - `reason`: kalimat Indonesia siap tampil — **tampilkan apa adanya.**
- **Batas perilaku:**
  - Tidak pernah memuat URL, token, atau nama host. Hanya mode dan boolean.
  - Belum login → **401** `{ "error": "Belum login." }`
  - Selama `readOnly: true`, notifikasi Telegram/WhatsApp nyata dan webhook ke
    CRM **tidak dikirim**. Tapi pengiriman **simulasi** (tanpa token) TETAP
    berjalan dan TETAP muncul di riwayat notifikasi — jangan menyimpulkan dari
    `readOnly: true` bahwa riwayatnya pasti kosong.
  - Alert yang ditahan **tidak** menghasilkan baris di riwayat notifikasi
    (bukan `failed`, bukan `sent`). Jejaknya di `audit_logs`. Jangan
    menampilkannya sebagai kegagalan pengiriman.
  - **Semua tombol yang menulis ke database portal tetap berfungsi normal** —
    acknowledge insiden, edit topologi, kelola pengguna, daftar channel, ekspor
    laporan. Mode ini tidak mematikan satu pun di antaranya.

### 10. Kesegaran cadangan — `GET /api/backup-freshness`

- **Dipakai untuk:** penanda "cadangan bermasalah" di shell, dan/atau satu
  kartu kecil di dashboard.
- **Cara pakai:** `GET /api/backup-freshness` — **cukup login**, peran apa pun.
  Cukup sekali per sesi (`useSWR`, `revalidateOnFocus: false`); nilainya hanya
  berubah sekali sehari saat cron berjalan.
- **Field:**
  - `needsAttention`: `boolean` — **satu-satunya yang dibutuhkan penanda.**
    `true` bila ADA aplikasi yang tidak `ok`.
  - `checkedAt`: ISO string
  - `apps[]`: `{ key, label, health, latestAt, ageHours, bytes, previousBytes,
    count, reason }`
  - `health`: `"ok"` | `"basi"` | `"mencurigakan"` | `"tidak-ada"`
  - `reason`: kalimat Indonesia siap tampil — **tampilkan apa adanya**, jangan
    disusun ulang dari `health` + angka.
- **Batas perilaku:**
  - Empat aplikasi selalu dikembalikan (`noc`, `crm`, `warehouse`,
    `enterprise`) walau foldernya tidak ada — yang itu ber-`health:
    "tidak-ada"`, dan itu **temuan**, bukan galat. Jangan disembunyikan.
  - `latestAt`/`ageHours`/`bytes` **null** bila belum ada cadangan sama sekali.
    Jangan render `0 jam` untuk null — nol jam berarti baru saja, kebalikannya.
  - Endpoint tidak pernah memuat isi cadangan; hanya nama, waktu, ukuran.
  - Di komputer pengembang folder cadangan tidak ada, jadi keempatnya akan
    `"tidak-ada"`. Itu benar, bukan yang perlu di-mock jadi hijau.

### 11. Probe & alarm — pemantauan milik portal sendiri

Portal kini mengukur keterjangkauan sendiri lewat TCP, tidak lagi hanya
menunggu LibreNMS. **Ini sumber yang BERBEDA dari `/api/v1/incidents`:**
`incidents` = apa yang DIKATAKAN LibreNMS lewat webhook; `alarms` = apa yang
portal ini SIMPULKAN dari probenya sendiri. Jangan digabung jadi satu daftar
tanpa menandai sumbernya — nanti tidak jelas siapa yang berhak menutup baris.

- **`GET /api/v1/probe-targets`** (cukup login) — `{ targets[] }` dengan
  `{ id, name, address, port, assetId, severity, isActive, status, latencyMs,
  consecutiveFails, failThreshold, checkedAt, hasOpenAlarm }`.
  - `status`: `"UP"` | `"DOWN"` | **`null`** (belum pernah diperiksa). Null
    bukan DOWN — jangan dirender merah.
  - `consecutiveFails` berguna ditampilkan bersama `failThreshold`: "2/3"
    memberi tahu alarm belum naik, dan itu memang disengaja.
- **`POST /api/v1/probe-targets`** (`admin`/`noc`) — daftarkan sasaran baru.
  Body: `{ name, address, port?, assetId?, severity?, intervalSec?, timeoutMs?,
  failThreshold? }`. Bawaan: port 443, severity `critical`, interval 60 detik,
  ambang 3, timeout 3000 ms. → **201** `{ id, name, address, port }`.
  - Ditolak **400**: `name`/`address` kosong, port di luar 1–65535,
    `failThreshold` < 1, atau `intervalSec` < 10 detik. Dua batas terakhir
    disengaja — ambang 0 membuat satu paket hilang langsung membangunkan orang,
    dan interval terlalu rapat membanjiri perangkat justru saat ia paling rapuh.
- **`GET /api/v1/alarms`** (cukup login) — alarm terbuka, maksimum 200,
  terbaru dulu. `?semua=1` untuk ikut yang sudah ditutup.
  - Field: `{ id, alarmNumber, severity, source, assetId, message, count,
    occurredAt, lastSeenAt, acknowledgedAt, clearedAt }`
  - `count` = berapa kali gangguan yang sama terulang. Satu gangguan tetap
    SATU baris; jangan tampilkan sebagai kejadian terpisah.
  - `source`: `"PROBE"` | `"LIBRENMS"` | `"MANUAL"`.
- **`POST /api/v1/alarms/:alarmId/acknowledge`** (`admin`/`noc`/`engineer`) —
  menandai sudah dilihat. **TIDAK menutup alarm.** Penutupan hanya terjadi
  karena sasarannya benar-benar pulih, supaya "sudah dilihat" tidak pernah
  tertukar dengan "sudah beres". Alarm yang sudah ditandai atau sudah ditutup
  → **404**.
- **`GET /api/v1/scheduler`** (cukup login) — `{ workerLikelyDown, tasks[] }`.
  - `tasks[]`: `{ code, name, description, isEnabled, intervalSec, lastRunAt,
    lastStatus, lastError, lastDurationMs, runCount, failCount, overdueSec,
    stalled }`
  - `workerLikelyDown: true` berarti ada tugas yang terlambat lebih dari 3×
    intervalnya. **Worker yang mati tidak menghasilkan galat apa pun** — yang
    tersisa cuma baris yang tidak pernah diperbarui, jadi inilah satu-satunya
    cara melihatnya dari layar.
    Toleransi 3× disengaja: satu putaran yang kelewat bukan kerusakan.

### 12. Situs, IPAM, FTTH, PPPoE, dan riwayat insiden

Semuanya sudah hidup dan terisi skema; sebagian besar masih kosong isinya
sampai ada yang mendaftarkan datanya lewat layar.

**Situs** — `GET/POST /api/v1/sites` (POST: `admin`/`noc`)
- `{ id, code, name, address, latitude, longitude, notes }`. `code` unik,
  otomatis huruf besar. Bentrok → **409**.
- `code` sengaja dibuat cocok dengan kolom teks `assets.site` yang sudah ada.
  Aset **tidak** punya `siteId`; tautannya lunak. Jangan bangun UI yang
  mengandaikan relasi keras.

**IPAM** — `GET/POST /api/v1/subnets`, `GET/POST /api/v1/subnets/:id/addresses`
- Subnet: `{ id, cidr, name, gateway, vlanId, siteId, purpose, usedCount }`.
  `usedCount` diturunkan dari tabel alamat, bukan kolom tersimpan.
- CIDR divalidasi ketat → **400** kalau bukan IPv4 CIDR yang sah.
  Duplikat → **409**.
- Alamat: `{ id, subnetId, address, assetId, label, status }`,
  `status`: `"dipakai"` | `"dicadangkan"` | `"bebas"`.
- Unik per **(subnet, address)**, bukan per alamat saja — alamat privat yang
  sama sah muncul di dua subnet berbeda. Pesan 409-nya menyebut "di subnet ini".

**FTTH** — `GET/POST /api/v1/ftth/odps`, `GET/PATCH /api/v1/ftth/odps/:id/ports`
- ODP: `{ id, code, name, siteId, oltId, latitude, longitude, capacity,
  usedPorts, brokenPorts }`.
  **`usedPorts` DITURUNKAN dari tabel port**, bukan kolom tersimpan — jangan
  pernah menampilkan angka terpakai dari sumber lain.
- **POST ODP otomatis membuat port sebanyak `capacity`** (1–256). Frontend
  tidak perlu membuat port satu per satu.
- PATCH port: body `{ portNumber, status?, externalServiceId?, notes? }`.
  `status`: `"kosong"` | `"terpakai"` | `"rusak"` | `"dicadangkan"`.
  Port tidak ada pada ODP itu → **404**.
- **`externalServiceId` adalah identitas layanan di sistem LAIN (CRM/ALUS).**
  Portal ini sengaja tidak menyimpan nama maupun alamat pelanggan — repo ini
  publik. Jangan menambah field identitas pelanggan di layar.

**PPPoE** — `GET /api/v1/pppoe/sessions`
- `{ lastRun, sessions[] }`. Sesi: `{ username, address, callerId, uptimeSec,
  routerName, seenAt }`.
- `lastRun`: `{ status, startedAt, finishedAt, sessionCount, error }` —
  `status` bisa `"SUCCESS"` | `"FAILED"` | `"SKIPPED"` | `"RUNNING"`.
- **`lastRun` WAJIB ditampilkan bersama daftarnya.** Daftar sesi yang tidak
  diperbarui terlihat persis sama dengan jaringan yang stabil. `SKIPPED`
  berarti router belum dikonfigurasi — itu keadaan yang benar hari ini, bukan
  gangguan.
- Penarikan yang gagal **tidak** menghapus gambaran terakhir; datanya jadi
  tua, dan umurnya terbaca dari `seenAt`/`lastRun`.
- Hanya `username` yang disimpan. Tidak ada nama pelanggan di sini, dan itu
  disengaja.

**Riwayat insiden** — `GET/POST /api/v1/incidents/:alertId/updates`
- `:alertId` menerima ID internal incident **maupun** `librenmsAlertId` —
  sama persis dengan rute `acknowledge` di sebelahnya.
- `{ id, incidentId, authorUserId, authorLabel, kind, body, createdAt }`,
  terlama dulu — dibaca sebagai cerita.
- `kind`: `"catatan"` | `"status"` | `"eskalasi"` | `"penyebab"` |
  `"penutupan"`. Selain itu → **400** dengan daftar yang sah.
- POST butuh `admin`/`noc`/`engineer`. **Append-only: tidak ada ubah maupun
  hapus**, dan itu bukan kelalaian — riwayat gangguan yang bisa disunting
  kehilangan gunanya justru saat orang menelusuri ulang apa yang diketahui
  dan kapan. Jangan bangun tombol edit/hapus.
- `authorLabel` terisi nama pengguna; `null` berarti catatan sistem.

### 13. Konsol perangkat — `POST /api/v1/devices/console`

Sebagian OLT tidak mendukung SNMP sama sekali (HSGQ-100-Kecicang), jadi
satu-satunya cara membacanya adalah masuk ke konsolnya. Endpoint ini
menyediakannya **dari dalam portal**, supaya tidak ada yang perlu membuka
telnet sendiri dari laptop — tanpa jejak, tanpa batas perintah.

- **Peran:** `admin` / `noc` saja.
- **Body:** `{ oltId, command }`. **Perangkat dipilih dari DAFTAR (`oltId`),
  bukan alamat.** Frontend TIDAK boleh menyediakan isian host/port — kalau
  ada, endpoint ini berubah jadi mesin telnet umum yang bisa diarahkan ke mana
  saja di jaringan.
- **Jawaban:** `{ olt: { id, name }, command, output }` — `output` teks mentah
  dari perangkat, tampilkan apa adanya dengan huruf monospace.
- **Kode galat, dan bedanya penting bagi yang membaca layar:**
  - **403** — perintah ditolak daftar putih. Pesannya menyebut perintah apa
    yang diizinkan; **tampilkan pesan servernya apa adanya**, jangan ganti
    dengan "akses ditolak" yang membuat orang mengira ini soal peran.
  - **409** — konfigurasi belum lengkap (kredensial belum diisi, atau OLT
    belum punya `telnet_port`). Ini bukan kerusakan.
  - **429** — lebih dari 20 perintah per menit per pengguna.
  - **502** — perangkatnya yang tidak menjawab.
- **Batas perilaku yang harus terlihat di layar:**
  - **Konsol ini BACA-SAJA, dan itu bukan kesopanan melainkan aturan.** Yang
    diizinkan hanya `show`, `display`, `enable`, `configure`, `interface`,
    `exit`, `quit`, `end`, `?`. Perintah yang mengubah keadaan ditolak
    **sebelum koneksi dibuka** — perangkat produksi tidak pernah menerimanya.
  - Penumpukan perintah (`;` `|` `&` baris baru) ditolak.
  - **Setiap percobaan dicatat di `audit_logs`** — yang ditolak maupun yang
    berhasil, lengkap dengan siapa dan perintah apa. Katakan ini di layar;
    orang berhak tahu bahwa yang ia ketik tercatat.
- **Catatan lapangan (diuji 19 Agustus 2026 ke HSGQ-100-Kecicang):**
  `show version` berhasil dan mengembalikan 12 baris. Perintah dengan lebih
  dari satu spasi (`show ont-optical 1`) ditolak PERANGKATNYA — spasi kedua
  dimakan parser VTY-nya. Itu perilaku perangkat, bukan bug portal; tampilkan
  jawaban perangkat apa adanya supaya orang bisa mencoba bentuk lain.

### 13.1. Daftar OLT — `GET /api/v1/ftth/olts`

Pengisi pilihan untuk §13. Ada karena §13 sengaja hanya menerima `oltId`:
layar konsol butuh daftar perangkat yang sah, dan tidak boleh menyusunnya
sendiri dari alamat yang diketik orang.

- **Peran:** cukup login. Yang membedakan adalah **isi** jawabannya, bukan
  aksesnya (lihat `konsolTersedia` di bawah).
- **Jawaban:** `{ olts: [...], konsolTersedia }`, urut menurut `name`.

  | Field | Isi |
  |---|---|
  | `id` | dipakai sebagai `oltId` pada §13 |
  | `name` · `managementIp` · `vendor` · `model` | identitas perangkat |
  | `siteId` · `siteName` | situs; `siteName` bisa `null` |
  | `telnetPort` | `null` berarti konsol tidak bisa dibuka |
  | `assetId` | tautan ke `/api/v1/assets/:assetId`, bisa `null` |
  | `odpCount` | jumlah ODP di bawah OLT ini |
  | `konsolSiap` | **boolean** — bisa dibuka SEKARANG atau tidak |
  | `alasan` | `null` bila siap; kalimat siap tampil bila tidak |

- **`konsolSiap` bukan tebakan.** Ia dihitung dengan pemeriksaan kredensial
  yang sama persis dengan yang dipakai saat menyambung. Matikan pilihan yang
  `false` dan tampilkan `alasan`-nya — kalau tidak, orang mengetik perintah
  lebih dulu lalu menerima **409**, dan 409 itu sebetulnya sudah bisa
  diketahui sebelum ia mengetik apa pun.
- **`konsolTersedia`** = `true` hanya untuk `admin`/`noc`, peran yang sama
  dengan §13. Bila `false`, **jangan tampilkan form perintahnya sama sekali** —
  dan sadari bahwa `alasan` yang diterima peran itu sengaja diperumum, karena
  ia menyebut nama env var kredensial bagi peran yang boleh memperbaikinya.
- **`credentialRef` tidak pernah dikirim.** Ia hanya nama env var, bukan kata
  sandi, tapi ia menunjuk langsung ke tempat kata sandi disimpan dan tidak ada
  layar yang membutuhkannya. Ada tes yang menahannya tetap begitu.

---

## Jebakan nama & bentuk

Yang paling sering salah tebak, dikumpulkan di satu tempat:

1. **`downloadGb`/`uploadGb`** di respons laporan trafik — bukan `downloadGB`.
   Tipe `TrafficReportRow` di `src/lib/mock-reports.ts` memang menulis `GB`,
   tapi itu bentuk seeder internal; yang keluar dari API adalah bentuk kolom
   database.
2. **Topologi dibungkus `{ detail: … }`** pada `GET`, `POST`, dan `PATCH` —
   sedangkan `publish` mengembalikan `{ topology: … }` tanpa `detail`.
3. **`total` = jumlah sebelum filter** di `/api/devices` dan `/api/v1/assets`,
   tapi **jumlah setelah filter** di `/api/notifications/logs` dan
   `/api/v1/incidents`.
4. **GeoJSON memakai `[lng, lat]`**, kebalikan dari urutan `latitude,
   longitude` di `NetworkDevice`.
5. **Grafik LibreNMS mengembalikan PNG**, bukan JSON — `getJson` akan gagal.
6. **`/api/devices/:id/live`** sudah menggabungkan tiga sumber; memanggil
   `/metrics` + `/olt-optics` terpisah berarti tiga kali beban untuk data yang
   sama.
7. `NetworkDevice.group` (`MikroTik|Ruijie|OLT`) adalah **turunan** dari
   `Asset.networkRole` + `Asset.vendor`, bukan field yang berdiri sendiri.
   Layar baru sebaiknya menampilkan `networkRole`.

---

## Belum bisa diandalkan

Bukan larangan memakai — tapi jangan bangun layar yang runtuh kalau ini
berubah, dan jangan tunjukkan angkanya sebagai fakta operasional.

- **Metrik & optik jatuh ke data tiruan** kalau LibreNMS belum dikonfigurasi
  (`isLibrenmsConfigured()` false) atau aset belum punya `librenmsDeviceId`.
  Bentuk responsnya identik, isinya deterministik per `deviceId` — mudah
  disangka data sungguhan. Periksa `snapshotSource` di endpoint status.
- **`/api/devices/:id/metrics-history` seluruhnya dibangkitkan** oleh
  `generateHistorySeries()` — belum ada tabel `metric_history`. Bentuk
  respons akan tetap; angkanya akan berubah total saat sumber asli masuk.
- **Laporan SLA & trafik di-seed otomatis** untuk periode yang belum ada
  datanya (`seedSlaIfMissing`, `seedTrafficIfMissing`). Angka periode lama
  bukan hasil pengukuran.
- **Tiga endpoint belum memeriksa login**: `/api/dashboard/summary`,
  `/api/reports/sla`, `/api/reports/traffic`. Ini akan ditutup dari sisi
  backend — jangan bangun layar yang bergantung pada endpoint ini bisa
  diakses tanpa sesi.
- **Rate limit webhook LibreNMS masih in-memory per proses** (10 permintaan
  per 10 detik per IP); di produksi multi-instance akan pindah ke Redis.

---

## Sebelum menguji jalur login

Database dev harus ikut termigrasi — skema di kode tidak otomatis sampai ke
database yang sudah ada:

```
set -a && . ./.env.local && set +a && npx drizzle-kit migrate
```

Tanpa itu `POST /api/auth/sign-in/portal` menjawab **500** karena kolom
`user.allow_local_login` belum ada, dan gejalanya terlihat seperti bug
backend padahal migrasinya yang tertinggal. (Terjadi 2026-08-18.)

## Tugas untuk Luna

Papan permintaan Opus → Luna (`WORKFLOW-TIM.md` §5). Semua di sini murni
pekerjaan tampilan — datanya sudah tersedia di endpoint yang disebut, tidak
ada yang perlu ditunggu dari backend. Tandai ✅ dan pindahkan ke §Selesai
kalau sudah dikerjakan.

### ✅ T-18. Kesehatan penjadwal — SELESAI 2026-08-20

**T-18 selesai:** `/probe` sekarang membaca `GET /api/v1/scheduler` dan
menampilkan kesehatan setiap pekerjaan worker. Sebelum implementasi 20
Agustus, endpoint ini sudah hidup sejak Fase 9 tetapi belum punya layar yang
membacanya.

- **Layar:** bebas — kartu di `/dashboard`, atau bagian di `/probe` (halaman
  itu sudah menampilkan hasil kerja penjadwal, tinggal menambahkan sumbernya).
- **Peran:** cukup login.

**Kenapa ini bukan hiasan.** Seluruh data bergerak di portal ini datang dari
worker: probe tiap 60 detik, sesi PPPoE tiap 60 detik. Kalau worker-nya mati
atau satu tugas mulai gagal, **layar tidak berubah sama sekali** — `/probe`
dan `/pppoe` tetap menampilkan angka terakhir, dan daftar yang membeku
terlihat persis seperti jaringan yang stabil. Pelajaran yang sama sudah
tertulis untuk `lastRun` di T-13; ini versi seluruh portalnya.

**Bentuk jawaban** — `{ tasks: [...] }`, tiap tugas:

| Field | Isi |
|---|---|
| `code` · `name` · `description` | `pppoe.poll`, `probe.run`, `probe.prune` |
| `isEnabled` · `intervalSec` | tiap berapa detik seharusnya jalan |
| `lastRunAt` · `lastStatus` | `SUCCESS` / gagal; **`null` = belum pernah jalan** |
| `lastError` · `lastDurationMs` | isi `lastError` saat gagal |
| `runCount` · `failCount` | kumulatif, bukan hari ini |
| `overdueSec` | **berapa detik terlambat dari jadwalnya** |
| `stalled` | **boolean — sudah lewat jauh dari jadwal** |

**Yang penting benar:**

- **`stalled: true` itu sinyalnya, bukan `lastStatus`.** Tugas bisa berstatus
  `SUCCESS` dan tetap macet — statusnya milik putaran terakhir yang berhasil,
  yang mungkin dua jam lalu. Layar yang cuma membaca `lastStatus` akan
  menampilkan hijau untuk worker yang sudah mati.
- **`lastRunAt: null` = belum pernah jalan**, bukan gagal. Bedakan.
- **`failCount` kumulatif sejak awal.** `pppoe.poll` hari ini
  `runCount 965, failCount 5` — lima kegagalan itu dari 18 Agustus, sebelum
  alamat router dipindah ke IP internal. Menampilkannya sebagai "5 gagal"
  tanpa konteks membuat orang mengejar hantu.
- **`probe.prune` jalannya sekali sehari** (`intervalSec: 86400`). Terakhir
  jalan kemarin itu **normal** — jangan tampilkan sebagai basi.
- **Jangan bikin tombol jalankan/matikan.** Penjadwal dikendalikan dari
  database dan worker; layar ini **melaporkan**, tidak memerintah.

**Kenapa tidak bisa diakali di sisi backend:** endpointnya sudah benar dan
sudah hidup. Yang hilang cuma mata yang membacanya.

### ✅ T-17. Layar login menyebut password email — SELESAI 2026-08-20

Ditemukan Opus 20 Agustus saat memeriksa `/login` di browser, sesudah mode
mailserver menyala.

> **T-17 sudah selesai.** Butir pertama dibatalkan (diselesaikan dari sisi
> server), sedangkan butir kedua kini ditampilkan dari `provider` pada
> `GET /api/auth-mode`: mode MAILSERVER menyebut password email (mailcow),
> dan mode LOCAL mempertahankan tampilan lama.

- ~~Label `Username atau Email` — hanya email yang berfungsi.~~
  **Dibatalkan 20 Agustus:** pemilik memilih menyelesaikannya dari sisi
  server, bukan mengganti labelnya. `LOGIN_DEFAULT_DOMAIN=perumnet.id` kini
  melengkapi username polos jadi alamat lengkap, jadi label yang ada sudah
  benar apa adanya. **Jangan diubah jadi `Email`.**
- **Layar tidak menyebut bahwa password-nya adalah password EMAIL.** Sejak
  20 Agustus password portal tidak berlaku lagi. Orang akan mengetik password
  lamanya, menerima 401, lalu mengira akunnya rusak.
  **Ambil dari `GET /api/auth-mode`, jangan tulis statis** — `provider` sudah
  ada di sana, dan halaman login boleh memanggilnya tanpa sesi (endpoint itu
  memang publik untuk keperluan ini). `MAILSERVER` → sebut "password email
  (mailcow)"; `LOCAL` → biarkan seperti sekarang.
- Sekalian, kalau sempat: `public/` masih memuat `next.svg`, `vercel.svg`,
  `file.svg`, `globe.svg`, `window.svg` bawaan Next.js. Tidak ada yang
  memakainya. Checklist design system menyebut aset brand resmi; ini sisa
  yang belum disapu.

**Kenapa tidak bisa dikerjakan dari backend:** servernya sudah benar — ia
menolak dengan pesan yang tepat. Yang salah adalah janji di layar sebelum
orang mengetik.

### ✅ T-16. Sembunyikan isian ganti email di `/profile` — SELESAI 2026-08-20

- **Layar:** `src/components/profile/profile-form.tsx`.
- **Butuh:** `emailChangeAvailable` dari `GET /api/auth-mode` (**baru
  20 Agustus**). `false` → jangan tampilkan isian emailnya sama sekali, sama
  seperti yang sudah kamu lakukan untuk form ganti password.
- **Kenapa ini penting, bukan kerapian:** sejak login lewat mailcow, alamat
  email **adalah** identitas. Mengubahnya ke alamat tanpa mailbox membuat akun
  itu tidak bisa dimasuki lagi — **dan tidak bisa dibatalkan**, karena
  membatalkannya menuntut login. Tidak ada endpoint admin yang bisa
  memperbaikinya; pemulihannya lewat database langsung.
- Server sudah menolak dengan **403**, jadi tidak ada lubang yang menganga.
  Yang tersisa adalah layar yang menawarkan sesuatu yang pasti ditolak —
  persis jenis tawaran yang membuat orang mengira aplikasinya rusak.
- Catatan di bawah isian yang berbunyi *"Mengganti email akan mereset status
  verifikasi"* ikut hilang; di mode mailserver kalimat itu tidak lagi
  menggambarkan apa pun yang bisa terjadi.

### ✅ T-15. Konsol perangkat — SELESAI 2026-08-20

- **Layar:** halaman baru, mis. `/console` — atau tab di halaman detail OLT.
- **Butuh:** §13, dan `GET /api/v1/ftth/olts` (§13.1) untuk mengisi
  pilihannya — endpoint itu **sudah ada sejak 2026-08-20**; catatan lama yang
  menyuruhmu membacanya sendiri dari `olt_devices` tidak berlaku lagi.
- **Yang WAJIB benar, ini endpoint paling berisiko di aplikasi:**
  - **Jangan sediakan isian host/port.** Perangkat dipilih dari daftar. Kalau
    frontend mengirim alamat bebas, seluruh penjagaan di server jadi sia-sia.
  - **Katakan di layar bahwa konsol ini baca-saja dan tercatat.** Orang berhak
    tahu sebelum mengetik, bukan sesudah ditolak.
  - **403 tampilkan pesan servernya apa adanya** — ia menyebut perintah apa
    yang diizinkan. Menggantinya dengan "akses ditolak" membuat orang mengira
    ini soal peran dan menyerah, padahal cukup mengubah perintahnya.
  - **409 bukan kerusakan** — itu konfigurasi yang belum lengkap.
  - `output` teks mentah: monospace, pertahankan baris, jangan dirapikan.
  - **Matikan pilihan yang `konsolSiap: false`** dan tampilkan `alasan`-nya di
    situ juga. Perangkat yang belum punya `telnet_port` atau kredensialnya
    belum disetel akan gagal — lebih baik terbaca sebelum perintah diketik
    daripada muncul sebagai 409 sesudahnya.
  - `konsolTersedia: false` berarti peran orang ini memang tidak boleh membuka
    konsol. Jangan tampilkan formnya sama sekali; `alasan` yang ia terima
    sengaja tidak menyebut nama env var.
- **Kenapa tidak bisa diakali di sisi frontend:** kredensial perangkat tidak
  pernah sampai ke browser, dan memang tidak boleh.

### ✅ T-11. Halaman Situs & IPAM — SELESAI 2026-08-19

- **Layar:** `/sites` dan `/ipam` (nama bebas), plus entri nav — **tambahkan**,
  jangan menata ulang.
- **Butuh:** §12 "Situs" & "IPAM". Keduanya masih kosong; layar ini yang akan
  mengisinya, jadi form tambah bukan pelengkap melainkan intinya.
- **Yang penting benar:**
  - `usedCount` subnet datang dari server. Jangan hitung ulang di klien.
  - Validasi CIDR ada di server dan mengembalikan 400 dengan pesan siap tampil.
    Validasi di form itu kenyamanan; **tampilkan pesan servernya apa adanya**.
  - 409 berarti duplikat — itu bukan galat sistem, tampilkan sebagai koreksi
    yang bisa ditindaklanjuti pengguna.

### ✅ T-12. Halaman FTTH (ODP & port) — SELESAI 2026-08-19

- **Layar:** `/ftth`, dengan tampilan port per ODP.
- **Butuh:** §12 "FTTH".
- **Yang penting benar:**
  - `usedPorts`/`brokenPorts` diturunkan server. Menampilkan angka terpakai
    dari hitungan klien akan menyimpang begitu ada dua orang membuka layar.
  - Membuat ODP otomatis membuat port sebanyak `capacity` — **jangan** buat
    layar "tambah port satu per satu".
  - **Jangan tambahkan field nama/alamat/nomor pelanggan.** Yang ada hanya
    `externalServiceId`. Repo ini publik dan itu batas yang disengaja.
  - Peta: ODP punya `latitude`/`longitude` — bisa menyatu dengan `/map` yang
    sudah ada. Kalau iya, **tambahkan lapisan**, jangan ubah lapisan yang ada.

### ✅ T-13. Halaman PPPoE — SELESAI 2026-08-19

- **Layar:** `/pppoe`.
- **Butuh:** §12 "PPPoE".
- **Yang penting benar, dan ini yang paling mudah salah:**
  - **Tampilkan `lastRun` sejelas daftarnya.** Daftar sesi yang membeku
    terlihat persis seperti jaringan yang stabil — tanpa umur data, layar ini
    berbohong dengan meyakinkan.
  - `status: "SKIPPED"` = router belum dikonfigurasi. Itu keadaan yang BENAR
    hari ini. Jangan dirender sebagai kegagalan.
  - `status: "FAILED"` → daftarnya masih ada tapi TUA. Tandai umurnya, jangan
    kosongkan layar.
  - Tidak ada nama pelanggan — jangan sediakan kolomnya.

### ✅ T-14. Riwayat pada halaman insiden — SELESAI 2026-08-19

- **Layar:** detail insiden (menyatu dengan `/notifications` atau halaman baru).
- **Butuh:** §12 "Riwayat insiden".
- **Yang penting benar:**
  - Append-only. **Jangan bangun tombol ubah atau hapus** — itu bukan fitur
    yang belum sempat dibuat, itu keputusan.
  - Urutan terlama dulu; ini dibaca sebagai kronologi, bukan umpan berita.
  - `kind` layak dibedakan secara visual — `eskalasi` dan `penyebab` adalah
    yang dicari orang saat menelusuri ulang.
  - `authorLabel: null` = catatan sistem; bedakan dari catatan orang.

### ✅ T-10. Halaman Probe & Alarm — SELESAI 2026-08-19

- **Layar:** halaman baru (mis. `/alarms` dan `/probe`), plus entri nav —
  **tambahkan** entri, jangan menata ulang yang sudah ada.
- **Butuh:** §11 di atas. Datanya sudah lengkap, tidak ada yang perlu ditunggu.
- **Yang penting ditampilkan benar:**
  - `status: null` berarti belum pernah diperiksa — **bukan** DOWN.
  - `count` pada alarm = pengulangan gangguan yang SAMA. Satu baris, bukan
    daftar kejadian.
  - Tombol acknowledge tidak menutup alarm. Kalau labelnya berbunyi seperti
    "selesai", orang akan mengira gangguannya beres.
  - `workerLikelyDown` dari `/api/v1/scheduler` layak jadi penanda kecil —
    kalau worker mati, seluruh angka di halaman ini membeku tanpa satu galat
    pun, dan halaman yang membeku terlihat persis seperti jaringan yang sehat.
- **Kenapa tidak bisa diakali di sisi frontend:** seluruh pengukuran dan daur
  hidup alarm terjadi di worker + database.

### ✅ T-9. Penanda "cadangan bermasalah" — SELESAI 2026-08-19

- **Layar:** bebas — shell (`noc-shell.tsx`) atau kartu di `/dashboard`.
- **Butuh:** `GET /api/backup-freshness` (§10). Tampilkan penanda **hanya bila**
  `needsAttention: true`; kalau semuanya sehat, jangan tampilkan apa pun.
  Di dalamnya, daftar `apps` yang `health !== "ok"` dengan `reason`-nya apa
  adanya.
- **Kenapa ini ada:** cadangan bisa berhenti diam-diam berbulan-bulan tanpa
  satu galat pun — yang tersisa cuma berkas yang tidak pernah diperbarui. Tidak
  ada yang membaca log cron. Sinyalnya sengaja ditaruh di layar yang memang
  sudah dibuka orang tiap hari, dan sengaja **pasif** (dibaca, bukan dikirim)
  supaya tetap jujur saat jaringan sedang rusak.
- **Nada:** ini bukan alarm jaringan. Jangan pakai pola merah berkedip; cukup
  terlihat. Yang membacanya tidak sedang menangani gangguan, ia sedang lewat.
- **Jangan** menyembunyikan `health: "tidak-ada"` sebagai "belum ada data" —
  aplikasi tanpa cadangan sama sekali justru yang paling perlu terlihat.

### ✅ T-7. Penanda "mode baca-saja" di shell — SELESAI 2026-08-19

- **Layar:** `src/components/layout/noc-shell.tsx` — penempatan terserah kamu,
  yang penting terlihat di semua halaman internal.
- **Butuh:** baca `GET /api/read-only-mode` sekali per sesi (`useSWR` dengan
  `revalidateOnFocus: false`, persis pola `useAuthMode()`), lalu:
  - `readOnly: true` → penanda tenang & permanen, mis. badge "Mode baca-saja".
    Tampilkan `reason` apa adanya sebagai tooltip atau teks pendamping.
    **Bukan** warna error/merah — ini keadaan yang BENAR, bukan gangguan.
  - `readOnly: false` → **tidak menampilkan apa-apa.** Tidak perlu badge "mode
    penuh"; ketiadaan penanda sudah berarti itu.
  - Gagal membaca (401/500) → **jangan menebak.** Diamkan penandanya; jangan
    menampilkan "mode penuh" hanya karena gagal membaca.
- **JANGAN ditampilkan di** `/customer/**` (halaman pelanggan tidak boleh
  membocorkan keadaan internal) dan `/login` (endpointnya butuh sesi).
- **Jangan menonaktifkan kontrol apa pun** berdasarkan nilai ini — lihat §9
  "Batas perilaku". Semua tombol tetap hidup.
- **Kenapa tidak bisa diakali di sisi frontend:** endpointnya sudah jalan dan
  sudah diuji; yang kurang hanya satu tempat di layar untuk menyatakannya.
  Tanpa itu, satu-satunya cara mengetahui portal sedang menahan aksi keluar
  adalah membaca `.env` di server.

### ✅ T-8. Terapkan design system PerumNet — SELESAI 2026-08-19

- **Layar:** seluruh shell + halaman login.
- **Butuh:** `docs/PERUMNET_FRONTEND_DESIGN_SYSTEM.md` diterapkan, lalu
  checklist di bagian akhirnya dicentang. Berkas itu **byte-per-byte sama**
  dengan milik CRM, jadi mengikutinya otomatis menyamakan tampilan kedua
  aplikasi — itu yang diminta pemilik proyek.
- **Jarak yang nyata hari ini** (diperiksa 19 Agustus, jangan ditebak ulang):
  - Token: CRM memakai `--pn-primary` dkk; di sini nama shadcn (`--primary`),
    nilainya sudah teal `#04a99f`. Yang berbeda nama, bukan warna.
  - Latar: doc meminta kanvas mint `#F7FBFA`→`#EDF7F5`; di sini
    `--background: #f8f8f6` (abu netral).
  - `public/brand/` sudah lengkap, tapi `next.svg`/`vercel.svg` bawaan
    Next.js masih tersisa di `public/`.
- **Batas:** jangan mengubah route, RBAC, autentikasi, atau API — doc itu
  menyatakannya sendiri di paragraf pembuka.
- **Kenapa tidak bisa diakali di sisi backend:** ini murni presentasi.

### ✅ T-4. Form login pindah ke satu pintu — SELESAI 2026-08-18

- **Layar:** `src/components/auth/login-form.tsx`.
- **Butuh:** form masih POST ke `/api/auth/sign-in/email`. Pindahkan ke
  **`POST /api/auth/sign-in/portal`** dengan body `{ email, password }` yang
  sama. Tiga jawaban yang harus dibedakan di layar:
  - **401** → *"Email atau password salah."* (tampilkan `message` apa adanya)
  - **503** → mailserver mati. **Jangan** tampilkan sebagai password salah dan
    jangan tawarkan "reset password" — orang akan mereset password email yang
    sebenarnya tidak bermasalah. Tampilkan `message` apa adanya.
  - **429** → terlalu banyak percobaan (5 per menit). Sebutkan tunggu sebentar.
- **Kenapa tidak bisa diakali di sisi backend:** endpointnya sudah jalan dan
  sudah diuji; yang menahan penyalaan mode mailserver tinggal form ini.
  Selama `AUTH_PROVIDER` masih `LOCAL`, `/sign-in/email` juga masih hidup —
  jadi perpindahan ini aman dilakukan kapan saja, tidak perlu serentak.

### ✅ T-5. Halaman `/register` dimatikan — SELESAI 2026-08-18

- **Layar:** `src/app/register`, `src/components/auth/register-form.tsx`.
- **Butuh:** pendaftaran mandiri sudah ditutup permanen di backend
  (`disableSignUp`), jadi halaman itu sekarang hanya menghasilkan error.
  Hapus halaman dan tautannya dari form login.
- **Kenapa tidak bisa diakali di sisi backend:** endpointnya sudah ditutup;
  yang tersisa halaman yang menjanjikan sesuatu yang tidak akan terjadi.

### Selesai

- **T-18** — `/probe` membaca `GET /api/v1/scheduler` dan menampilkan
  status `stalled` terpisah dari status putaran terakhir, jadwal,
  keterlambatan, timestamp, durasi, serta hitungan gagal kumulatif. Error,
  loading, empty, dan data terakhir ditangani; panel bersifat read-only tanpa
  kontrol untuk menjalankan atau mematikan worker.
- **T-17** — `/login` membaca `provider` dari `GET /api/auth-mode` dan
  menampilkan keterangan bahwa mode MAILSERVER memakai password email
  (mailcow); mode LOCAL mempertahankan tampilan lama. Label `Username atau
  Email` tidak diubah, dan aset SVG bawaan Next.js yang tidak dipakai dihapus.
- **T-16** — `/profile` membaca `emailChangeAvailable`; input email dan
  peringatan verifikasi disembunyikan saat mode MAILSERVER, dengan fail-closed
  saat mode login belum terbaca.
- **T-15** — `/console` memakai `GET /api/v1/ftth/olts`, menampilkan kesiapan
  OLT sebelum perintah dijalankan, menonaktifkan pilihan yang belum siap, dan
  menyembunyikan form untuk peran yang tidak memiliki akses konsol.
- **T-7** — Shell internal menampilkan penanda mode baca-saja yang tenang hanya
  saat `readOnly: true`, tanpa membocorkan status internal ke halaman publik.
- **T-8** — Token warna, kanvas mint, shell dark-teal, login satu-kartu,
  drawer responsif, dan checklist design system diterapkan; diverifikasi pada
  desktop, tablet, dan mobile tanpa overflow.
- **T-9** — Shell menampilkan daftar aplikasi backup bermasalah hanya saat
  `needsAttention: true`, dengan `reason` server apa adanya dan tanpa pola alarm
  merah berkedip.
- **T-10** — Halaman `/probe` dan `/alarms` menampilkan status null secara
  netral, `workerLikelyDown`, alarm teragregasi, sumber alarm, dan aksi
  "Tandai sudah dilihat" tanpa menyamakan acknowledge dengan penutupan.
- **T-11** — Halaman `/sites` dan `/ipam` ditambahkan dengan form server-backed,
  pesan validasi server, `usedCount` dari server, serta detail alamat yang dapat
  dibuka per subnet.
- **T-12** — Halaman `/ftth` ditambahkan untuk ODP dan port, memakai angka
  `usedPorts`/`brokenPorts` dari server, tanpa form port satu per satu maupun
  identitas pelanggan.
- **T-13** — Halaman `/pppoe` menonjolkan `lastRun`, membedakan SUCCESS/FAILED/
  SKIPPED/RUNNING, dan mempertahankan sesi terakhir ketika polling gagal.
- **T-14** — Riwayat incident append-only ditambahkan ke `/notifications`
  dengan urutan kronologis, visual `kind`, dan label `Sistem` untuk author null.

- **T-4** — `login-form.tsx` memakai `POST /api/auth/sign-in/portal` dan
  membedakan mailserver mati dari kredensial salah. Diverifikasi dari kode.
- **T-5** — `/register` diubah jadi pengalihan ke `/login`, bukan dihapus.
  Lebih baik: deep-link dan cache peramban lama tidak jadi 404.
- **T-1** — Badge LibreNMS membedakan `Data contoh`, `Offline`, dan `Live`.
  Ketiga state diverifikasi di browser pada fixture, konfigurasi kosong, dan
  stub LibreNMS yang tidak terjangkau.
- **T-2** — `useDeviceLive()` memakai satu SWR `/api/devices/:id/live` setiap
  10 detik untuk device/metrics/optics; history dan RRD tetap terpisah.
  Detail perangkat diverifikasi di browser.
- **T-3** — Dashboard dan laporan memakai `ApiErrorNotice` yang menampilkan
  `ApiError.message` dan tautan masuk kembali untuk 401; tidak lagi diam-diam
  merender chart kosong. Route terlindungi dan DOM layar diverifikasi.
- **T-6** — `useAuthMode()` dipakai pada profil dan form pengguna. Browser
  memverifikasi mode LOCAL tetap menampilkan form, sedangkan MAILSERVER
  menyembunyikan form password profil dan input password pengguna; kegagalan
  membaca mode menahan form secara aman.

---

## Riwayat

- **2026-08-20** — T-18: `GET /api/v1/scheduler` hidup sejak Fase 9 tapi NOL
  layar memanggilnya. Kalau worker mati, tidak ada apa pun di layar yang
  berubah — daftar yang membeku terlihat seperti jaringan yang stabil.
- **2026-08-20** — Perangkat tanpa SNMP tidak lagi `warning` selamanya:
  statusnya kini datang dari probe TCP yang memang sudah memeriksanya tiap
  60 detik. Dashboard sekarang 7/7 online, 0 warning.
- **2026-08-20** — **Masuk dengan username saja** (`LOGIN_DEFAULT_DOMAIN`,
  §8.1 OPERATIONS). Label `Username atau Email` yang sudah ada kini benar —
  bagian T-17 yang menyuruh menggantinya DIBATALKAN. Sisa T-17 tinggal
  menyebut bahwa password-nya password EMAIL.
- **2026-08-20** — T-17: layar login tidak menyebut password email padahal
  mode mailserver sudah menyala. Ditemukan saat memeriksa `/login` di
  browser — tidak terlihat dari kode backend maupun dari kode HTTP mana pun.
- **2026-08-20** — **`PATCH /api/profile/email` 403 di mode MAILSERVER** +
  `emailChangeAvailable` di `/api/auth-mode`. Tugas T-16. Lubang ini lahir
  beberapa jam sebelumnya saat mode mailserver dinyalakan: sampai pagi itu
  ganti email tidak berbahaya, sesudahnya ia mengunci akun tanpa bisa
  dibatalkan.
- **2026-08-20** — **577 ODP kini tertaut ke OLT-nya** (sebelumnya `oltId`
  kosong semua, dan `odpCount` di §13.1 selalu 0). `/ftth` sekarang bisa
  dikelompokkan per OLT kalau itu membantu — 6 OLT, terbesar 180 ODP.
  Perhatikan **Kecicang punya DUA OLT**: jangan kelompokkan per situs dan
  menganggapnya sama dengan per OLT.
- **2026-08-20** — **Login satu pintu mailcow HIDUP di produksi.**
  `AUTH_PROVIDER=MAILSERVER`. 8 akun: 5 lewat mailcow, `admin@perumnet.id`
  akun darurat, 2 akun `@perumnet.co.id` lama kini tidak bisa masuk (domainnya
  memang bukan domain email). Yang perlu kamu ubah ada di §1.
- **2026-08-20** — `GET /api/v1/ftth/olts` (§13.1) — pengisi pilihan layar
  konsol. Membawa `konsolSiap` supaya perangkat yang pasti gagal terbaca
  SEBELUM perintah diketik, bukan sebagai 409 sesudahnya. T-15 tidak lagi
  memblokir apa pun.
- **2026-08-19** — Konsol perangkat (§13) + tugas T-15. Lahir karena sebagian
  OLT tidak mendukung SNMP; daripada orang membuka telnet sendiri tanpa jejak,
  portal menyediakannya dengan daftar putih perintah dan audit penuh.
- **2026-08-19** — Fase 10: situs, IPAM, FTTH, PPPoE, riwayat insiden (§12).
  Tugas T-11…T-14. Sengaja TIDAK dibuat tabel `network_devices`/`network_links`
  tandingan — `assets` dan `topology_*` yang sudah ada diperluas, supaya tidak
  lahir dua daftar perangkat yang pelan-pelan berbeda isinya.
- **2026-08-19** — Fase 9: penjadwal + probe milik portal sendiri (§11) —
  `probe-targets`, `alarms`, `alarms/:id/acknowledge`, `scheduler`. Tugas T-10.
  Lahir karena LibreNMS melaporkan 0 perangkat, sehingga portal buta bukan
  karena rusak melainkan karena sumbernya kosong.
- **2026-08-19** — `GET /api/backup-freshness` (§10) + tugas T-9. Lahir dari
  malam yang sama: cadangan CRM ternyata salah nama database berbulan-bulan dan
  menghasilkan berkas kosong, dan tidak ada yang membaca log cron.
- **2026-08-19** — Mode baca-saja ditegakkan di kode: `GET /api/read-only-mode`
  (§9), penjaga aksi keluar di `notifyCrm`/`sendTelegram`/`sendWhatsApp`.
  Tugas T-7 (penanda di shell) dan T-8 (design system) dibuka. Rute
  `POST /api/notifications/channels/verify` kini menuntut header `x-bot-token`
  — hanya menyentuh bot, bukan layar mana pun.
- **2026-08-17** — Satu pintu login: `POST /api/auth/sign-in/portal` +
  `GET /api/auth-mode`; `/sign-up/email` ditutup permanen, `/sign-in/email`
  dan `/change-password` mati saat `AUTH_PROVIDER=MAILSERVER`. Tugas T-4…T-6.
- **2026-08-17** — Isi pertama: seluruh 35 endpoint yang ada di `src/app/api`
  didaftarkan, diverifikasi langsung dari route handler dan tipe payloadnya.
  Papan tugas untuk Luna dibuka dengan T-1…T-3.
