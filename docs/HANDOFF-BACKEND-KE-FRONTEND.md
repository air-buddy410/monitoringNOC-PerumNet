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
  | `GET /api/reports/sla?period=YYYY-MM` | cukup login | `{ period, targetPercent, source, rows, summary }` |
  | `GET /api/reports/traffic?period=YYYY-MM` | cukup login | `{ period, source, rows, summary }` |
  | `GET /api/reports/traffic?from=YYYY-MM&to=YYYY-MM` | idem | agregasi rentang |
  | `GET /api/reports/export/excel?type=&period=` | **admin/manajemen** | berkas `.xlsx` |
  | `GET /api/reports/export/pdf?type=&period=` | **admin/manajemen** | berkas `.pdf` |
- **Field:**
  - SLA `rows[]`: `deviceId`, `deviceName`, `group`, `area`, `uptimePercent`,
    `downtimeMinutes`, `incidents`, `meetsTarget`. Urut **uptime terendah
    dulu**. `targetPercent` = **99.5**; `summary` = `{ devices, averageUptime,
    belowTarget }`. **`averageUptime` bisa `null`** — lihat `source` di bawah.
  - Trafik `rows[]`: `deviceId`, `deviceName`, `group`, `area`, **`downloadGb`,
    `uploadGb`** (huruf b kecil), `avgMbps`, `peakMbps`. Urut download
    terbesar dulu. `summary` = `{ devices, totalDownloadGb, totalUploadGb }`.
- **`source` — dari mana angkanya datang** (baru, 21 Agustus; ada di ketiga
  jawaban laporan, termasuk agregasi rentang):
  | Nilai | Artinya |
  |---|---|
  | `terukur` | ada isinya dan bukan fixture |
  | `fixture` | mode pengembangan — angkanya **dibangkitkan, bukan diukur** |
  | `belum-ada-data` | periode itu belum punya rekap. **BUKAN nol.** |

  Di produksi hari ini jawabannya selalu `belum-ada-data`: agregasi dari
  LibreNMS belum ditulis, dan sejak 21 Agustus backend tidak lagi mengarang
  isinya. Tugas **T-23** menampilkan keadaan ini dengan jujur.
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

### 14. Trafik jaringan — `/api/v1/traffic/*`

Kartu "Trafik jaringan" di `network-telemetry.tsx` sejak lahir bertuliskan
*"belum tersedia"*. Sekarang datanya ada, dan **nyata**: uplink terbaca
±3 Gbps masuk / 315 Mbps keluar, per situs juga terpisah.

Trafik diambil worker dari MikroTik tiap **30 detik** dan disimpan; endpoint
membacanya dari database. **Endpoint tidak pernah menghubungi router** — jadi
berapa pun jumlah penonton, beban ke perangkat produksi tetap nol.

#### `GET /api/v1/traffic/live` — cukup login

```jsonc
{
  "generatedAt": "2026-08-20T…", "sampledAt": "2026-08-20T…",
  "ageSeconds": 12, "stale": false,
  "totals": { "uplinkRxBps": 3034700000, "uplinkTxBps": 315300000 },
  "interfaces": [{
    "id": "…", "ifName": "sfp-sfpplus1", "label": "Uplink Utama",
    "role": "uplink",            // uplink | site | other
    "siteId": null,
    "rxBps": 3034700000, "txBps": 315300000,
    "capacityBps": 10000000000, "utilizationPercent": 30.3,
    "sampledAt": "…", "state": "ok", "missingSince": null
  }]
}
```

#### `GET /api/v1/traffic/series?interfaceId=…&hours=24` — cukup login

`{ interfaceId, label, hours, points: [{ t, rxBps, txBps }], coverage }`

#### Lima hal yang WAJIB benar

1. **Satuannya bps (bit per detik), selalu `number`.** Jangan bikin pembagi
   sendiri di komponen. **`formatBitrate` sekarang SUDAH ADA** di
   `src/lib/noc-format.ts` — pakai itu (`3.034.700.000` → `3,03 Gbps`).
   Pembaginya 1000, bukan 1024, supaya angka portal sama persis dengan angka
   yang sama di LibreNMS; selisih ~7% terlalu kecil untuk terlihat salah dan
   terlalu besar untuk diabaikan. Dua definisi "Mbps" yang pembulatannya
   berbeda akan menghasilkan dua angka untuk hal yang sama.
2. **`state: "belum-ada-data"` BUKAN `rxBps: 0`.** Interface yang baru
   dipantau belum punya pembanding; lajunya belum ada, bukan nol. Bedakan di
   layar — nol yang dikarang terbaca sebagai "trafik berhenti".
3. **`utilizationPercent` bisa `null`.** Jangan jadikan 0. Bar 0% pada uplink
   3 Gbps lebih menyesatkan daripada tidak ada bar.
4. **`stale` dan `ageSeconds` harus TERLIHAT.** Layar yang membeku terlihat
   persis seperti jaringan yang tenang — itu kegagalan paling berbahaya di
   fitur ini, karena ia terlihat meyakinkan. `stale: true` jangan halus.
5. **Titik `null` di `series` bukan nol.** `connectNulls={false}`; garis
   diputus, tidak ditarik ke dasar. Titik hilang saat worker restart atau
   counter router di-reset — menggambarnya sebagai 0 memunculkan jurang yang
   tidak pernah terjadi.

`role: "site"` boleh punya `siteId: null` — satu VLAN bisa menaungi lebih dari
satu situs (`102-VLAN-Seraya` menaungi Seraya Barat DAN Tengah). Pakai
`label`, jangan menyimpulkan situs dari nama interface.

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

### 15. Mode TV — wallboard `/tv`

Layar monitor yang digantung di ruang NOC. Tidak ada yang login di sana, tidak
ada keyboard, dan tidak ada yang menungguinya. Seluruh rancangan di bawah lahir
dari tiga kenyataan itu.

Backend-nya sudah hidup di produksi sejak 20 Agustus (commit `dd7841b`).
Tabelnya `tv_tokens`, dan sampai hari ini **belum ada satu token pun** — karena
layarnya memang belum dibuat. Itu tugas T-21 dan T-22.

#### Cara sebuah layar tersambung

```
1. Admin menerbitkan token  → POST /api/v1/tv/tokens      → dapat `url`
2. URL dibuka di TV          → /tv#token=…                 (FRAGMEN, bukan query)
3. Halaman menukar token     → POST /api/v1/tv/session     → cookie HttpOnly
4. Halaman membersihkan URL  → history.replaceState(null, "", "/tv")
5. Halaman polling           → GET /api/v1/tv/snapshot     → seluruh isi layar
```

**`/tv` publik di `src/proxy.ts` DENGAN SENGAJA** — bukan kelalaian. Wallboard
tidak punya keyboard; pengalihan ke `/login` berarti layar mati permanen sampai
ada orang datang membawanya. Penjagaannya token, bukan sesi.

#### `GET /api/v1/tv/snapshot` — satu permintaan untuk SELURUH layar

Satu-satunya endpoint yang menerima cookie TV. Halaman `/tv` **tidak boleh
memanggil endpoint lain mana pun** — semuanya akan menjawab 401, termasuk
`/api/v1/traffic/live` yang isinya mirip.

```jsonc
{
  "generatedAt": "2026-08-21T01:20:00.000Z",   // satu umur data untuk semuanya
  "traffic": { /* persis bentuk §14 GET /traffic/live — lima aturannya berlaku */ },
  "devices": {
    "total": 7, "online": 7, "warning": 0, "offline": 0,
    "markers": [{ "id": "…", "label": "OLT Kecicang",
                  "lat": -8.44, "lng": 115.58, "status": "online" }]
  },
  "outages": {
    "clusters": [{ "level": "ODP",      // SITUS | OLT | ODP
                   "id": "…", "name": "ODP-KCC-012",
                   "padam": 6, "total": 8 }],
    "padamTotal": 21, "padamTersebar": 15, "aktifTotal": 1715
  },
  "incidents": [{ "id": "…", "deviceName": "OLT Kecicang",
                  "message": "PON 1/1 turun", "severity": "critical",
                  "state": "active", "triggeredAt": "…" }],   // maks 10, yang belum resolved
  "pppoe": { "current": 1603, "lastRunStatus": "SUCCESS",
             "trend": [{ "t": "…", "count": 1603 }] }          // ±96 titik, 24 jam
}
```

`401` = tautan belum ditukar, sudah dicabut, atau kedaluwarsa. Ketiganya
sengaja tidak dibedakan.

#### `POST /api/v1/tv/session` — menukar token jadi cookie

Body `{ "token": "…" }`. Jawaban `200 { ok: true, name }`, dan cookie HttpOnly
terpasang. `400` body bukan JSON / token kosong, `401` tidak berlaku,
`429` lebih dari 10 percobaan per menit per IP.

Token dikirim di **body**, bukan query, supaya ia tidak pernah masuk access
log, log Next, maupun header `Referer` ke pihak ketiga.

#### `GET`/`POST /api/v1/tv/tokens` dan `POST /api/v1/tv/tokens/:id/revoke` — admin

`GET` → `{ tokens: [{ id, name, tokenPrefix, createdAt, expiresAt, lastUsedAt,
useCount, revokedAt }] }`. **Tidak pernah memuat token maupun hash-nya** — yang
ada hanya 8 karakter pertama, untuk mencocokkan mana yang mana.

`POST` body `{ name, expiresInDays? }` (bawaan 90 hari, maksimum 365) →
`201 { id, name, token, url, expiresAt, peringatan }`.

> **`token` dan `url` hanya ada di jawaban ini, sekali, selamanya.** Yang
> tersimpan cuma SHA-256-nya. Kalau layar menutup dialog tanpa orangnya sempat
> menyalin, satu-satunya jalan adalah menerbitkan token baru.

`POST …/revoke` → `{ ok: true }`, atau `404`. **Berlaku seketika**: layar mati
pada polling berikutnya, bukan saat cookie habis.

#### Delapan hal yang WAJIB benar

1. **Token ada di FRAGMEN, dan fragmen harus tetap di sisi klien.** Jangan
   pernah memindahkannya ke query string, ke `<img src>`, ke state yang
   ter-serialize ke server, atau ke `localStorage`. Fragmen tidak pernah
   dikirim ke server — itulah satu-satunya alasan token ini tidak berakhir di
   access log Nginx dan di header `Referer` ke `basemaps.cartocdn.com` setiap
   kali peta memuat tile.
2. **Bersihkan URL segera setelah penukaran berhasil.**
   `history.replaceState(null, "", "/tv")`. TV menyala di ruangan yang orang
   luar bisa masuki; token yang terpampang di address bar bisa difoto.
3. **Coba `snapshot` DULU, baru fragmen.** Saat halaman dimuat ulang (listrik
   kedip, browser restart), fragmennya sudah lama dibuang tapi cookienya masih
   sah — layar harus langsung hidup lagi tanpa siapa pun datang. Urutannya:
   `GET snapshot` → kalau 200 jalan terus; kalau 401 baru lihat fragmen; kalau
   fragmen juga tidak ada, tampilkan pesan "layar belum tersambung".
4. **401 di tengah jalan JANGAN dialihkan ke `/login`.** Itu tautan yang
   dicabut atau kedaluwarsa. Tampilkan pesan tenang di layar itu sendiri —
   redirect ke halaman login pada TV tanpa keyboard hanya menghasilkan layar
   mati yang tidak bisa dijelaskan siapa pun di ruangan.
5. **`generatedAt` harus TERLIHAT, dan `traffic.stale` jangan halus.** Ini
   aturan §14 nomor 4, dan di sini bobotnya lebih berat: wallboard adalah layar
   yang tidak ditunggui. Layar beku terlihat persis seperti jaringan yang
   tenang — kegagalan paling berbahaya di seluruh fitur ini, karena ia terlihat
   meyakinkan.
6. **Seluruh lima aturan §14 berlaku apa adanya untuk `traffic`.** `null` bukan
   nol, `utilizationPercent` bisa `null`, titik hilang diputus bukan ditarik ke
   dasar.
7. **`outages.clusters` tidak memuat username pelanggan, dan itu disengaja.**
   Sampai 21 Agustus 2026 ia memuatnya — daftar username PPPoE mengalir utuh ke
   layar terbuka, dan ke siapa pun yang tautannya bocor. Sudah ditutup di
   backend (`rapikanPadam`, `tests/tv-snapshot-sanitize.test.ts`). Jangan
   memintanya kembali: angka "6 dari 8 padam di ODP-KCC-012" sudah cukup untuk
   mengirim teknisi, dan nama pelanggan tidak menambah apa pun yang berguna di
   dinding ruangan.
8. **Rancang untuk mata dari 3 meter, bukan untuk mouse.** Tidak ada hover,
   tidak ada tooltip sebagai satu-satunya jalan ke informasi, tidak ada modal,
   tidak ada yang perlu diklik. Angka besar, kontras tinggi, jangan font tipis.
   Halaman harus sanggup menyala berhari-hari tanpa disentuh — hati-hati
   dengan `setInterval` yang menumpuk dan memori yang merayap naik.

#### Yang sudah diurus backend, jangan diakali di layar

- **Cookie diperbarui tiap permintaan snapshot yang sah**, jadi layar yang
  dibiarkan menyala tidak akan mati sendiri pada jam ke-12. Perpanjangan tidak
  pernah melampaui masa berlaku token, dan pencabutan tetap seketika
  (`tests/tv-snapshot-cookie.test.ts`). Kamu tidak perlu menyimpan token untuk
  menukar ulang — jangan.
- **Muatan sudah dipangkas**: tidak ada IP, hostname, vendor, model, nomor
  seri, maupun username. Kalau sebuah kolom terasa kurang, tulis di
  `PERMINTAAN-FRONTEND-KE-BACKEND.md` — jangan cari jalan lain.
- **`Referrer-Policy: no-referrer`** sudah dipasang di `next.config`.

### 16. OTB, tray, dan port — `/ftth/otb`

Kotak terminasi tempat kabel feeder diurai jadi core per port. Petugas
lapangan menyebut posisi sebagai "Tray 3 port 5", dan seluruh bentuk data di
bawah mengikuti kalimat itu — bukan meringkasnya jadi satu angka kapasitas.

Backend-nya sudah lengkap, tabelnya `otb`, `otb_trays`, `otb_ports` (migrasi
`0008_otb_tray_port`). Sampai hari ini **belum ada satu OTB pun** — layarnya
memang belum dibuat. Itu tugas T-24.

Acuan visual: `docs/gambar/otb-detail-*.jpeg`. Latar domainnya di
`docs/PRD-OTB-CORE-ROUTE-MASTER-SPLITTER.md` — versi yang sudah disesuaikan ke
portal ini (Drizzle, tabel yang benar-benar ada, empat peran yang benar-benar
dipakai). Dokumen asal yang ditulis untuk Prisma disimpan di
`docs/arsip/PRD-OTB-ASLI-PRISMA.md`; itu **arsip, bukan acuan** — jangan
mengambil nama model atau daftar permission dari sana.

#### Yang ADA dan yang BELUM di fase ini

Dari empat tab pada acuan visual, **hanya "Inventori Tray" yang punya data**.
"Peta Jalur", "Detail Core", dan "Riwayat" menunggu fase berikutnya — core
fiber, closure, dan trace engine belum ada di database mana pun.

#### Cara sebuah layar tersusun

```
1. Dropdown "Pilih OTB"      → GET  /api/v1/ftth/otb
2. Baris pemilih tray        → GET  /api/v1/ftth/otb/:otbId
   (+ kepala: konektor, polish, status tiap tray)
3. Tab "Inventori Tray"      → GET  /api/v1/ftth/otb/:otbId/trays/:n/ports
4. Menandai satu port        → PATCH …/trays/:n/ports
5. Menambah/mengurangi port  → PATCH …/trays/:n        (admin/noc)
```

#### GET /api/v1/ftth/otb — pengisi dropdown

```jsonc
{ "otb": [{
  "id": "…", "code": "OTB-KCC-01", "name": "OTB POP Kecicang",
  "siteId": "s1", "siteName": "Kecicang",   // null kalau OTB tiang
  "defaultConnectorType": "LC",             // konektor SESUNGGUHNYA ada di tray
  "defaultPolish": "APC",
  "latitude": null, "longitude": null,      // terisi hanya bila siteId null
  "status": "aktif",                        // "aktif" | "nonaktif"
  "trayCount": 4, "portCount": 96,          // DITURUNKAN dari baris, bukan kolom
  "usedPorts": 17, "brokenPorts": 3
}] }
```

Urut `code` menaik, supaya pilihan tidak berpindah-pindah antar-muat.

#### GET /api/v1/ftth/otb/:otbId — kepala + seluruh tray

```jsonc
{
  "id": "…", "code": "OTB-KCC-01", "name": "OTB POP Kecicang",
  "siteId": "s1", "siteName": "Kecicang",
  "defaultConnectorType": "LC", "defaultPolish": "APC",
  "latitude": null, "longitude": null,
  "status": "aktif", "notes": null,
  "createdAt": "…", "updatedAt": "…",
  "trays": [{
    "id": "…", "trayNumber": 1,
    "connectorType": "LC", "polish": "APC",   // per TRAY — satu rak boleh campur
    "label": null,
    "portCount": 24, "usedPorts": 24, "brokenPorts": 0,
    "status": "terhubung"      // "terhubung" | "sebagian" | "kosong" | "nonaktif"
  }]
}
```

`404` kalau OTB tidak ada.

#### GET /api/v1/ftth/otb/:otbId/trays/:n/ports — tab Inventori Tray

```jsonc
{ "ports": [{
  "id": "…",
  "portNumberInTray": 17,     // yang tercetak di tray
  "globalPortNumber": 17,     // yang ditulis dokumen & label — layar menyebutnya "Core 17"
  "status": "terpakai",       // kosong | terpakai | dicadangkan | rusak | nonaktif
  "externalServiceId": "SRV-00931",
  "notes": null, "updatedAt": "…"
}] }
```

Urut `portNumberInTray`. `400` kalau `:n` bukan bilangan bulat positif, `404`
kalau tray itu tidak ada pada OTB tersebut.

#### PATCH …/trays/:n/ports — menandai satu port (admin/noc/engineer)

Body `{ "portNumberInTray": 17, "status": "terpakai", "externalServiceId": "SRV-1", "notes": null }`
— hanya `portNumberInTray` yang wajib. Jawaban `200 { id, portNumberInTray, status }`.

`400` body bukan JSON / `portNumberInTray` bukan bilangan bulat / `status` di
luar kelima nilai. `404` OTB, tray, atau port tidak ada. `409` OTB-nya
`nonaktif`.

#### PATCH …/trays/:n — kapasitas tray (admin/noc)

Body `{ "portCount": 28 }` — **bentuk akhir, bukan selisih**. Dua permintaan
bersamaan yang masing-masing menyebut "+4" akan saling menimpa diam-diam; dua
yang menyebut "jadi 28" tidak.

Jawaban `200 { trayId, portCount }`. `409` kalau ada port yang akan hilang dan
port itu tidak kosong, masih memegang `externalServiceId`, atau pernah punya
riwayat perubahan — pesannya menyebut nomor portnya, tampilkan apa adanya.

#### Tujuh hal yang WAJIB benar

1. **"Core 17" di layar berarti `globalPortNumber`, BUKAN core fiber.**
   Fase berikutnya membawa core fiber sungguhan: kabel 24-core yang core
   ke-7-nya mendarat di port 17. Sejak itu "core 7" dan "core 17" menunjuk
   benda berbeda pada sambungan yang sama. Sepakati sekarang: di layar OTB,
   "Core N" = nomor port global. Kalau label ini berubah setelah operator
   terbiasa, ongkosnya jauh lebih besar daripada mengubahnya hari ini.

2. **Jangan pernah menghitung sendiri nomor global.** Rumus
   `(tray-1) * portPerTray + slot` benar hanya sampai kapasitas diubah untuk
   pertama kali. Setelah tray 1 dikecilkan dari 24 ke 12, tray 2 tetap mulai
   dari 25 — lubang 13–24 memang dibiarkan, karena nomor yang sudah terbit
   tidak boleh dipakai ulang. `globalPortNumber` selalu ikut di setiap
   respons port; pakai itu.

3. **Nomor tray boleh berlubang, dan itu sah.** Tray yang dicabut dari rak
   adalah kejadian nyata, dan nomor tray tetangganya tidak ikut bergeser —
   nomor itu tercetak di badan rak dan dipakai teknisi untuk menemukan port.
   Render `trayNumber` apa adanya; jangan memakai indeks array.

4. **Lencana tray datang dari server, jangan dihitung ulang di layar.**
   Empat nilainya (`terhubung`/`sebagian`/`kosong`/`nonaktif`) punya urutan
   pemeriksaan yang merupakan definisinya, dan sudah diuji di
   `tests/otb-status-tray.test.ts`. Tray tanpa port sama sekali berlencana
   `kosong`, bukan `terhubung` — 0 dari 0 bukan penuh.

5. **Konektor dan polish adalah dua field terpisah.** Layar boleh menuliskan
   "LC/APC", tapi jangan pernah mengirimkannya kembali sebagai satu string.
   Nilainya per TRAY, bukan per OTB: satu rak boleh memuat tray SC dan tray
   LC sekaligus. `defaultConnectorType` di kepala OTB hanya nilai awal saat
   tray baru dibuat.

6. **Master Splitter di acuan visual (MS-01) bukan entitas baru.** Ia `odps`
   berperan `MS` yang sudah ada sejak Fase 10 — 63 baris di produksi, rasio
   1:8 dan 1:16 tersimpan di `capacity`, koordinat lengkap. Endpointnya
   `GET /api/v1/ftth/odps` (§12). Jangan menunggu endpoint master-splitter
   baru; tidak akan ada.

7. **Jangan menambahkan identitas pelanggan di layar OTB.** Aturannya sama
   dengan `odp_ports`: yang boleh disimpan hanya `externalServiceId` — ID
   layanan di CRM/ALUS. Repo ini publik.

#### Yang sudah diurus backend, jangan diakali di layar

- **Pembuatan OTB membangun seluruh tray dan portnya dalam satu transaksi.**
  Kegagalan di tengah tidak meninggalkan OTB yatim
  (`tests/otb-routes.test.ts`). Jangan membuat tray satu per satu dari layar.
- **Setiap perubahan port menulis baris `audit_logs` sebelum/sesudah.** Itu
  bukan hiasan: aturan penurunan kapasitas membacanya untuk tahu port mana
  yang pernah disentuh. Jangan membuat jalur pintas yang melewatinya.
- **Tidak ada `DELETE` OTB, dan itu disengaja.** FK-nya cascade, jadi satu
  DELETE memusnahkan seluruh tray, port, dan kegunaan jejak auditnya. Cara
  menonaktifkan OTB adalah `status: "nonaktif"`.

### 17. Kabel, core, dan terminasi — Fase 12

Lapisan di antara OTB dan ODP: bentangan kabel, serat di dalamnya, dan ujung
serat yang menempel di sebuah port. Inilah yang membuat pertanyaan "port OTB
mana yang menyuapi ODP ini" akhirnya punya jawaban di database.

Tabelnya `fiber_cable_segments`, `fiber_cores`, `fiber_core_terminations`
(migrasi `0009_kabel_core_terminasi`). Belum ada satu kabel pun — layarnya
belum dibuat. Itu tugas T-25.

Latar domainnya di `docs/PRD-OTB-CORE-ROUTE-MASTER-SPLITTER.md` §3.

#### GET /api/v1/ftth/cables — daftar kabel

```jsonc
{ "cables": [{
  "id": "…", "code": "KBL-FDR-01", "name": "Feeder POP → RK Seraya",
  "category": "feeder",        // backbone|feeder|distribution|dropcore|interconnect|lain
  "fiberType": "G.652D",
  "coreCount": 24,
  "lengthM": 3250,             // METER, dan boleh null — lihat aturan 1
  "status": "aktif",
  "coreTerpasang": 24,         // jumlah baris core; turunan
  "coreFeeder": 24, "coreDistribution": 0, "coreRusak": 0
}] }
```

#### POST /api/v1/ftth/cables — admin/noc

Body: `{ code, category, coreCount, name?, fiberType?, lengthM?, purpose?, tubeSize?, notes? }`.
Core dibuat sekaligus sebanyak `coreCount`, dalam satu transaksi, lengkap
dengan warnanya.

**`tubeSize` mengisi penomoran kedua.** Catatan lapangan memakai DUA
penomoran: nomor serat se-kabel, dan posisinya di dalam tabung ("TUBE 5 CORE
3"). Kalau `tubeSize` diisi, `tubeNumber` dan `coreInTube` ikut terisi dan
keduanya dijaga constraint. ADSS 144 core lazimnya `tubeSize: 12`
(12 tabung × 12 serat) — lihat `docs/referensi/kabel-adss-144.json`.
Kosongkan untuk kabel yang memang tidak bertabung (dropcore, patch). `purpose` mengisi seluruh core; kalau tidak disebut ia
mengikuti `category`. Jawaban `201 { id, code, coreCount }`.

`400` body/kategori/serat/`coreCount` tidak sah (1–288). `409` kode sudah dipakai.

#### GET /api/v1/ftth/cables/:cableId — kabel + seluruh core-nya

```jsonc
{
  "id": "…", "code": "KBL-FDR-01", "category": "feeder", "lengthM": 3250,
  "cores": [{
    "id": "…", "coreNumber": 1,
    "tubeNumber": 1, "coreInTube": 1,   // null untuk kabel tanpa tabung
    "color": "biru",            // dari server — jangan dihitung sendiri
    "purpose": "feeder",        // feeder | distribution
    "label": null, "status": "baik", "notes": null,
    "ujungTerpakai": ["A"]      // ujung yang punya terminasi AKTIF: [] | ["A"] | ["A","B"]
  }]
}
```

`404` kalau kabel tidak ada.

#### POST /api/v1/ftth/terminations — admin/noc

Menempelkan satu ujung core ke satu port.

Body: `{ coreId, coreEnd: "A"|"B", otbPortId?, odpPortId?, reason }` — isi
**tepat satu** dari `otbPortId` atau `odpPortId`. Jawaban `201 { id, coreId, coreEnd }`.

| Kode | Kapan |
|---|---|
| `400` | `reason` kosong, `coreEnd` bukan A/B, dua sasaran, atau tanpa sasaran |
| `404` | core atau port tidak ada |
| `409` | core rusak, kabel/OTB nonaktif, port sudah terpakai, ujung core sudah terminasi, atau core feeder ke port ODP |

#### GET /api/v1/ftth/cores/:coreId/terminations — cukup login

Riwayat terminasi satu core — **termasuk yang sudah dilepas**. `GET
/cables/:id` hanya mengirim ujung yang aktif, jadi panel riwayat membaca dari
sini.

```jsonc
{ "terminations": [{
  "id": "…", "coreEnd": "A", "aktif": false,
  "reason": "instalasi awal",
  "deactivatedAt": "…", "deactivatedReason": "kabel diganti",
  "createdAt": "…",
  "sasaran": { "jenis": "otbPort", "label": "OTB-1 · Tray 1 port 17",
               "otbCode": "OTB-1", "trayNumber": 1,
               "portNumberInTray": 17, "globalPortNumber": 17 }
}] }
```

Urut dari yang paling lama. `sasaran.label` sudah dirakit di server — jangan
memanggil endpoint lain sekali per baris untuk mencari nama OTB-nya.

#### GET /api/v1/ftth/cables/:cableId/terminations — cukup login

Riwayat terminasi **seluruh core** dalam satu kabel, satu permintaan. Bentuk
barisnya sama dengan endpoint per-core, ditambah `coreId` dan `coreNumber`,
dan sudah terurut per nomor core lalu waktu.

Pakai ini untuk panel riwayat di layar kabel. Memanggil endpoint per-core
sekali untuk tiap core membuat kabel 288 core menjadi 288 permintaan HTTP.

#### POST /api/v1/ftth/terminations/:id/release — admin/noc

Body `{ reason }`. Melepas terminasi dan mengembalikan portnya jadi `kosong`.
`409` kalau sudah pernah dilepas.

Sengaja POST ke sub-jalur, **bukan `DELETE`**: barisnya tidak dihapus.

#### PATCH /api/v1/ftth/otb/:otbId — admin/noc

Lubang yang tertinggal sejak Fase 11, sekarang tertutup. Body:
`{ name?, siteId?, latitude?, longitude?, status?, notes?, defaultConnectorType?, defaultPolish? }`.

`400` kalau `trayCount`/`portsPerTray`/`portCount` ikut dikirim — kapasitas
punya jalurnya sendiri di `PATCH …/trays/:n`. `400` juga kalau OTB jadi tanpa
situs **dan** tanpa koordinat.

#### Delapan hal yang WAJIB benar

1. **`lengthM` boleh `null`, dan `null` bukan nol.** `null` berarti belum
   diukur. Tampilkan `—`, jangan `0 m`. Ini pelajaran yang sama persis dengan
   `averageUptime` di laporan SLA: angka nol yang sebenarnya "tidak tahu"
   dibaca sebagai fakta operasional, dan keputusan diambil di atasnya.

2. **Satuannya METER, bukan kilometer.** Layar boleh menampilkan "3,25 km";
   yang dikirim dan diterima tetap `3250`. Kilometer pecahan mengundang
   pembulatan yang menumpuk sepanjang jalur berpuluh segmen.

3. **`reason` wajib di setiap mutasi, dan bukan formalitas.** Jangan mengisinya
   otomatis dengan teks generik seperti "update". Enam bulan lagi, saat ada
   yang menelusuri kenapa sebuah jalur pernah dipindah, kalimat itulah satu-
   satunya yang bisa menjawab.

4. **Melepas terminasi tidak menghapusnya.** Riwayat "core ini pernah menempel
   di sini, dilepas tanggal sekian, alasannya ini" tetap ada dan justru itu
   separuh nilai modul ini saat gangguan. Layar riwayat core harus
   menampilkannya, bukan cuma yang aktif.

5. **`409` "baru saja dipakai permintaan lain" berarti BALAPAN.** Muat ulang
   dan tampilkan keadaan terbaru — jangan mencoba ulang otomatis. Dua operator
   yang menekan simpan bersamaan memang harus melihat bahwa yang satu kalah.

6. **Warna core datang dari server.** Jangan menghitungnya dari nomor core —
   dan khususnya jangan dari nomor se-kabel. Warna serat mengikuti POSISINYA
   DI DALAM TABUNG: serat ke-13 adalah serat pertama tabung 2, jadi ia biru
   lagi, bukan warna ke-13. Sebagian vendor juga memakai urutan sendiri; yang
   tercetak di kabel selalu lebih benar, dan itu bisa ditimpa di database.

7. **Tampilkan `tubeNumber` dan `coreInTube` berdampingan dengan
   `coreNumber`.** Teknisi di lapangan menyebut serat sebagai "tabung 5 core
   3", bukan "core 53". Layar yang cuma menampilkan satu dari dua penomoran
   memaksa orang menghitung di kepala, sambil berdiri di tiang.

8. **Core feeder tidak boleh berakhir di port ODP.** Jangan cukup menyembunyi-
   kan pilihannya di layar — kirim saja, biarkan server menolak, lalu tampilkan
   pesannya apa adanya. Menyembunyikan opsi membuat operator mengira datanya
   yang salah, bukan aturannya.

#### Yang sudah diurus backend, jangan diakali di layar

- **Okupansi dijamin database**, bukan kode: tiga *partial unique index* di
  `fiber_core_terminations` memastikan satu ujung core dan satu port hanya
  punya satu terminasi aktif. Ada tes yang menulis langsung ke tabel untuk
  membuktikannya (`tests/fiber-terminasi.test.ts`). Jangan menambahkan
  pemeriksaan tandingan di klien — ia akan salah lebih dulu.
- **Port yang membawa core tidak bisa dihapus.** FK-nya `restrict`, jadi
  aturan penurunan kapasitas tray Fase 11 tetap berlaku tanpa perubahan.
- **Master splitter di acuan visual tetap `odps` berperan `MS`** — endpointnya
  `/api/v1/ftth/odps` (§12). Aturan "hanya core distribution" berlaku untuk
  ODP biasa saja; port MS boleh menerima core feeder, karena itu memang
  input feedernya.

### 18. Closure dan silangan core — Fase 13

Sambungan di lapangan tempat core dari dua kabel disambung. Di sinilah
"Core 17 menjadi Core 23" akhirnya bisa dicatat sebagai kenyataan, bukan
catatan pinggir di buku teknisi.

Tabelnya `fiber_closures` dan `fiber_core_splices` (migrasi
`0010_closure_silangan`). Belum ada satu closure pun — layarnya belum dibuat.
Itu tugas T-26.

Acuan visual: tabel **"Silangan Core (Closure/Joint)"** di
`docs/gambar/otb-detail-core.jpeg`.

#### GET /api/v1/ftth/closures — daftar

```jsonc
{ "closures": [{
  "id": "…", "code": "CL-01", "name": "Closure Simpang Seraya",
  "siteId": null, "siteName": null,
  "latitude": -8.4521, "longitude": 115.6033,
  "type": "inline",            // inline | dome | lain
  "status": "aktif",
  "silanganAktif": 22, "silanganTotal": 25   // total termasuk yang sudah dilepas
}] }
```

#### POST /api/v1/ftth/closures — admin/noc

Body `{ code, name?, siteId?, latitude?, longitude?, type?, notes? }`.
`400` kalau tanpa situs **dan** tanpa koordinat. `409` kode sudah dipakai.

#### GET /api/v1/ftth/closures/:closureId — matriks silangan

Tambahkan `?riwayat=1` untuk ikut menampilkan silangan yang sudah dilepas.

```jsonc
{
  "id": "…", "code": "CL-01", "type": "inline", "status": "aktif",
  "splices": [{
    "id": "…",
    "inputCableCode": "KBL-A",  "inputCoreNumber": 17, "inputCoreColor": "merah",
    "inputCoreEnd": "B",        "inputCablePurpose": "feeder",
    "outputCableCode": "KBL-B", "outputCoreNumber": 23, "outputCoreColor": "kuning",
    "outputCoreEnd": "A",       "outputCablePurpose": "feeder",
    "silang": true,             // nomor berubah — dihitung server, jangan dibanding sendiri
    "estimatedLossDb": 0.1,     // ESTIMASI, bukan hasil ukur. Boleh null.
    "reason": "silang core saat perbaikan",
    "deactivatedAt": null, "deactivatedReason": null,
    "createdAt": "…"
  }]
}
```

#### POST …/closures/:closureId/splices/preview — admin/noc

Body `{ rows: [...] }`. Memeriksa **tanpa menulis apa pun**.

```jsonc
{
  "verdicts": [
    { "urutan": 1, "ok": true, "silangNomor": { "dari": 17, "ke": 23 } },
    { "urutan": 2, "ok": false, "error": "Ujung core masuk (core 1) sudah punya sambungan aktif. …" }
  ],
  "ringkas": { "total": 2, "gagal": 1, "lolos": 1 }
}
```

#### POST …/closures/:closureId/splices — admin/noc

Body `{ rows: [{ inputCoreId, inputCoreEnd, outputCoreId, outputCoreEnd, estimatedLossDb? }], reason }`.
Maksimal 288 baris. Jawaban `201 { dipasang, ids, verdicts }`.

**`409` berarti TIDAK ADA yang tersimpan** — pesannya menyebut baris pertama
yang gagal beserta alasannya.

#### POST /api/v1/ftth/splices/:spliceId/release — admin/noc

Body `{ reason }`. `409` kalau sudah pernah dilepas. Barisnya **tidak dihapus**.

#### Tujuh hal yang WAJIB benar

1. **Nomor core BOLEH berubah di closure — itu fiturnya, bukan anomali.**
   Tampilkan nomor masuk dan nomor keluar berdampingan, dan tandai yang
   berbeda. Jangan pernah menampilkan satu nomor saja dan menganggap sisi lain
   sama; itu justru kesalahan pencatatan manual yang modul ini ada untuk
   menghentikannya. Server sudah mengirim `silang: true|false` — pakai itu,
   jangan membandingkan sendiri.

2. **`409` pada pemasangan massal berarti NOL baris tersimpan.** Jangan pernah
   menampilkan "3 dari 5 berhasil". Matriks yang tersimpan separuh terlihat
   sudah dikerjakan, dan itu lebih berbahaya daripada yang jelas-jelas kosong.
   Setelah `409`, muat ulang dan tampilkan keadaan sebenarnya.

3. **Jalankan pratinjau sebelum commit, dan percayai hasilnya.** Keduanya
   memakai fungsi pemeriksa yang sama persis di server — ada tes yang menuntut
   verdict-nya identik. Jangan menulis validasi tandingan di klien; ia akan
   salah lebih dulu dan membuat operator berhenti mempercayai pratinjaunya.

4. **Kalau pembagian ditolak, tampilkan pesannya apa adanya.** Pesan servernya
   sudah menyebut jalan keluarnya ("pembagian hanya lewat master splitter").
   Mengganti dengan "gagal menyimpan" membuang satu-satunya petunjuk yang
   dipunyai operator.

5. **`estimatedLossDb` adalah ESTIMASI.** Beri label yang menyebut itu di
   layar — "estimasi rugi", bukan "rugi optik". Boleh `null`, artinya belum
   dimodelkan; tampilkan `—`, jangan `0 dB`. Kalau kelak ada data OTDR, ia
   ditampilkan terpisah dan tidak boleh dicampur.

6. **`?riwayat=1` bukan pelengkap.** Silangan yang sudah dilepas justru yang
   dicari orang saat gangguan — "jalur ini dulu lewat mana". Sediakan
   togel riwayat di layar matriks, jangan hanya keadaan sekarang.

7. **Di layar kecil, matriks jadi KARTU, bukan tabel yang meluber.** Tabel
   masuk/keluar punya delapan kolom; di 375 px ia hanya bisa dibaca dengan
   menggeser ke samping, dan itu dikerjakan sambil berdiri di tiang.

#### Yang sudah diurus backend, jangan diakali di layar

- **Larangan membagi ditegakkan index unik**, bukan kode — ada tes yang
  menulis langsung ke tabel untuk membuktikannya
  (`tests/closure-silangan.test.ts`).
- **Ujung core yang sudah diterminasi ke port tidak bisa disambung**, dan
  sebaliknya. Diperiksa lintas-tabel di server.
- **Batch bersifat satu transaksi.** Tidak perlu mengirim baris satu per satu
  untuk "aman" — justru sebaliknya, itu menghilangkan jaminannya.

### 19. Trace jalur core — Fase 14

Menelusuri jalur dari port OTB sampai ONT pelanggan, lewat kabel, closure, dan
master splitter. **Tidak ada tabel baru** — seluruh jalur diturunkan dari yang
sudah dicatat Fase 11–13.

Ini yang menghidupkan panel **"Jalur Singkat Core"**, **"Rincian Panjang
Jalur"**, dan **"Informasi Output (Akhir Jalur)"** pada acuan visual.

#### GET /api/v1/ftth/trace — cukup login

```
?dari=otbPort&id=<portId>
?dari=odpPort&id=<portId>
?dari=core&id=<coreId>&ujung=A|B
```

```jsonc
{
  "mulai": { "jenis": "otbPort", "id": "…", "label": "OTB-1 Tray 1 port 1 (global 1)" },
  "jalur": [{
    "status": "LENGKAP",   // LENGKAP|UJUNG_JALUR|JALUR_PUTUS|BERPUTAR|AMBIGU|TERPOTONG
    "diagnosis": null,     // kalimat siap tampil; null hanya saat LENGKAP
    "langkah": [
      { "urutan": 1, "jenis": "PORT_OTB",  "label": "OTB-1 · Tray 1 port 1", "detail": { … } },
      { "urutan": 2, "jenis": "CORE",      "label": "KBL-A · core 17 (merah)",
        "detail": { "segmentCode": "KBL-A", "coreNumber": 17, "color": "merah",
                    "purpose": "feeder", "dariUjung": "A", "keUjung": "B",
                    "panjangM": 850 } },
      { "urutan": 3, "jenis": "SILANGAN",  "label": "CL-01 · core 17 → core 23",
        "detail": { "closureCode": "CL-01", "dariCoreNumber": 17, "keCoreNumber": 23,
                    "silang": true, "estimasiRugiDb": 0.1, "rugiDariModel": true } },
      { "urutan": 5, "jenis": "SPLITTER",  "label": "MS-1 · master splitter 1:8 · port 1" },
      { "urutan": 7, "jenis": "PORT_ODP",  "label": "ODP-1 · port 1" }
    ],
    "ringkas": {
      "hop": 7,
      "panjangM": 2300,          // METER; null kalau belum ada segmen terukur
      "panjangLengkap": true,    // false = ada segmen yang panjangnya belum diukur
      "segmenUnik": 3,
      "segmenBerulang": 0,       // > 0 = ada kabel yang dilewati bolak-balik
      "estimasiLossDb": 1.3,     // ESTIMASI, bukan hasil ukur
      "sambunganPakaiModel": 5
    }
  }],
  "ringkas": { "total": 2, "lengkap": 2, "bermasalah": 0 }
}
```

`400` `dari` tidak dikenal, atau `dari=core` tanpa `ujung`. `404` titik awal
tidak ada.

#### Delapan hal yang WAJIB benar

1. **`jalur` adalah DAFTAR, bukan satu.** Melewati master splitter membuat satu
   jalur bercabang jadi beberapa — 1:8 menghasilkan sampai delapan. Jangan
   pernah menampilkan `jalur[0]` saja dan menganggap itu "jalurnya".

2. **Cabang yang putus tidak menghapus cabang yang lengkap.** Kalau lima ODP
   tersambung dan satu core rusak, hasilnya lima jalur: empat `LENGKAP`, satu
   `JALUR_PUTUS`. Tampilkan semuanya — dua-duanya kenyataan, dan yang rusak
   itulah yang dicari.

3. **`diagnosis` sudah berupa kalimat siap tampil.** Ia menyebut DI MANA
   jalurnya berhenti dan kenapa. Jangan menggantinya dengan "trace gagal" —
   itu membuang satu-satunya petunjuk yang dipunyai teknisi.

4. **`estimasiLossDb` adalah ESTIMASI.** Beri label yang menyebut itu.
   `sambunganPakaiModel` memberi tahu berapa komponen yang memakai angka model
   alih-alih angka tersimpan; kalau tinggi, angkanya makin kasar. Kalau kelak
   ada data OTDR, ia ditampilkan TERPISAH dan tidak boleh dicampur.

5. **`panjangLengkap: false` berarti totalnya belum utuh** — ada segmen yang
   panjangnya belum diukur, dan ia TIDAK dijumlahkan sebagai nol. Tampilkan
   "≥ 2.300 m" atau beri penanda, jangan angka polos yang terlihat pasti.

6. **`segmenBerulang > 0` bukan bug.** Itu kabel yang dilewati bolak-balik —
   keluar lewat satu core, kembali lewat core lain pada kabel yang sama.
   Jaraknya memang dihitung dua kali, karena cahayanya memang menempuh dua
   kali. Jalur yang benar-benar berputar muncul sebagai status `BERPUTAR`.

7. **`SPLITTER` bukan `PORT_ODP`.** Beri ikon dan perlakuan berbeda —
   percabangan di master splitter itu SAH, sedangkan percabangan di luar itu
   dilaporkan sebagai `AMBIGU`. Menyamakan keduanya menghapus perbedaan yang
   jadi inti seluruh modul ini.

8. **`AMBIGU` berarti DATANYA yang salah, bukan trace-nya.** Ia muncul kalau
   satu ujung core punya terminasi dan silangan sekaligus, atau satu splitter
   punya dua input feeder. Arahkan operator ke perbaikan data, jangan menyuruh
   coba lagi.

#### Yang sudah diurus backend, jangan diakali di layar

- **Jalur berputar terdeteksi**, tidak menggantung. Ada batas hop keras juga.
- **Arah penelusuran di splitter disimpulkan dari peruntukan core** — feeder =
  input, distribution = keluaran. Telusur balik dari sebuah ODP tidak akan
  menyeberang ke ODP tetangga. Aturan "satu splitter, satu input feeder"
  ditegakkan saat terminasi.
- **Identitas pelanggan tidak ikut.** Hanya `externalServiceId`.

### 20. Sesi PPPoE — tabel, saringan, urutan, dan halaman

Layar `/pppoe` selama ini menerima **seluruh sesi sekaligus** (batas 2.000) dan
menyaring sendiri di browser. Di produksi itu ~1.600 baris JSON tiap kali
halaman dibuka, untuk menampilkan dua puluh.

Bebannya satu soal. Yang lebih berbahaya: **penyaringan di browser hanya
menyaring yang TERKIRIM.** Begitu jumlah sesi melewati batas, hasil pencarian
jadi tidak lengkap tanpa ada yang tahu — dan "pelanggan itu tidak ada di
daftar" terlihat persis sama dengan "pelanggan itu offline".

Sekarang semuanya dikerjakan database.

#### GET /api/v1/pppoe/sessions — cukup login

| Parameter | Nilai | Bawaan |
|---|---|---|
| `q` | cari di `username`, `address`, **dan** `callerId` sekaligus | — |
| `router` | saring satu router | semua |
| `sort` | `username` · `address` · `uptime` · `seenAt` · `router` | `username` |
| `dir` | `asc` · `desc` | `asc` |
| `page` | halaman, 1-basis | 1 |
| `pageSize` | **20 · 50 · 100** — hanya ketiganya | 20 |

```jsonc
{
  "lastRun": { "status": "SUCCESS", "startedAt": "…", "finishedAt": "…",
               "sessionCount": 1603, "error": null },
  "sessions": [{ "username": "…", "address": "10.20.0.7", "callerId": "…",
                 "uptimeSec": 84600, "routerName": "RB-Kecicang", "seenAt": "…" }],
  "total": 1603,          // SETELAH saringan — bukan jumlah seluruh sesi
  "page": 1,
  "pageSize": 20,
  "halamanTerakhir": 81,
  "terpotong": false,
  "routers": ["RB-Kecicang", "RB-Seraya"]   // pengisi dropdown saringan
}
```

`400` untuk `sort`, `dir`, atau `pageSize` yang tidak dikenal — ditolak, bukan
diabaikan diam-diam.

> **Tanpa `page` maupun `pageSize`, jawabannya tetap seperti dulu**: seluruh
> sesi sampai 2.000 baris. Itu disengaja supaya layar lama tidak kehilangan
> 1.580 barisnya di antara deploy backend dan pembaruan frontend. **Begitu
> T-28 mendarat, mode itu tidak dipakai lagi** — selalu kirim `page` dan
> `pageSize`.

#### Enam hal yang WAJIB benar

1. **Selalu kirim `page` dan `pageSize`.** Tanpa keduanya layar menarik ~1.600
   baris tiap muat, dan seluruh gunanya perubahan ini hilang.

2. **`total` adalah jumlah SETELAH saringan, bukan jumlah seluruh sesi.**
   Pakai itu untuk "menampilkan 1–20 dari 137", dan untuk menghitung tombol
   halaman. Jangan pernah menghitung jumlah dari `sessions.length` — itu
   panjang halaman, bukan jumlah hasil.

3. **Jangan menyaring atau mengurut lagi di browser.** Bukan soal boros: hasil
   halaman 1 yang diurut ulang di klien akan berbeda dari halaman 2, karena
   yang diurut cuma dua puluh baris yang kebetulan ada di tangan.

4. **Ubah saringan atau urutan → kembali ke halaman 1.** Tetap di halaman 7
   setelah menyaring jadi 12 hasil menampilkan layar kosong, dan itu terbaca
   sebagai "tidak ada pelanggan".

5. **`terpotong: true` berarti mode lama memotong hasil diam-diam.** Itu hanya
   muncul kalau `page`/`pageSize` tidak dikirim dan sesi melewati 2.000.
   Kalau sampai terlihat, aturan 1 sedang dilanggar.

6. **`lastRun` tetap wajib ditampilkan.** Daftar sesi yang tidak diperbarui
   terlihat persis sama dengan jaringan yang stabil. Umur data itu bagian dari
   datanya.

#### Yang sudah diurus backend

- Halaman di luar jangkauan **dijepit**, bukan mengembalikan kosong. Jumlah
  sesi berubah tiap dua menit; halaman 9 yang sah saat diklik bisa sudah tidak
  ada saat permintaannya tiba. Periksa `page` di jawaban — ia bisa berbeda
  dari yang kamu kirim.
- **Urutannya pasti.** Ada kunci kedua (`username`), jadi baris tidak
  berpindah antar-muat dan tidak muncul di dua halaman sekaligus.
- Pencarian **tidak peduli huruf besar-kecil**, dan memang substring:
  `AA:BB:12` juga cocok dengan `AA:BB:120`. Itu disengaja — operator mengetik
  potongan yang dia ingat.

### 21. Garis jalur fiber di peta — Fase 15

Letak kabel **diturunkan**, bukan disimpan: ujung yang diterminasi ke port
OTB/ODP memakai koordinat perangkatnya, ujung yang disambung di closure
memakai koordinat closure-nya. Tidak ada kolom geometri di database.

#### GET /api/v1/ftth/geo — cukup login

```jsonc
{
  "simpul": [
    { "jenis": "OTB",     // OTB | CLOSURE | MS | ODP
      "id": "…", "code": "CONTOH-OTB-POP-01", "name": "…",
      "latitude": -8.4498, "longitude": 115.5987 }
  ],
  "garis": [{
    "id": "…", "code": "CONTOH-KBL-FDR-01",
    "category": "feeder",        // backbone|feeder|distribution|dropcore|…
    "lengthM": 850,              // boleh null
    "koordinat": [[115.5987, -8.4498], [115.6033, -8.4521]],  // [lon, lat] !
    "dari": { "jenis": "OTB",     "code": "CONTOH-OTB-POP-01" },
    "ke":   { "jenis": "CLOSURE", "code": "CONTOH-CL-01" },
    "coreTerpakai": 2, "coreTotal": 24
  }],
  "tanpaGeometri": [
    { "id": "…", "code": "KBL-X", "category": "feeder",
      "alasan": "ODP-X belum punya koordinat." }
  ],
  "ringkas": { "kabelAktif": 3, "tergambar": 2, "tanpaGeometri": 1 }
}
```

#### Tujuh hal yang WAJIB benar

1. **`koordinat` memakai urutan GeoJSON `[lon, lat]`. Leaflet memakai
   `[lat, lng]`.** Kedua urutan itu terbalik, dan menukarnya tidak
   menghasilkan galat apa pun — kabelnya cuma muncul di Samudra Hindia, dan
   tidak ada yang bisa menjelaskan kenapa. Balik dulu sebelum diberikan ke
   `<Polyline positions={…}>`.

2. **Kabel di `tanpaGeometri` TIDAK BOLEH digambar** — tidak sebagai garis
   putus-putus, tidak sebagai garis lurus antar-perkiraan, tidak sebagai
   apa pun. Garis di peta jaringan dipakai orang untuk memutuskan ke mana
   berangkat saat kabel putus, dan garis tebakan mengirim teknisi ke tempat
   yang salah dengan keyakinan penuh.

3. **Tapi `tanpaGeometri` juga tidak boleh disembunyikan.** Ia daftar
   pekerjaan: tiap barisnya menyebut kabel dan alasannya ("ODP-X belum punya
   koordinat"). Tampilkan sebagai panel di samping peta. Peta yang jujur
   mengaku tidak tahu lebih berguna daripada peta yang terlihat lengkap.

4. **Feeder dan distribution dibedakan secara visual** (warna atau ketebalan),
   dan **jangan hanya lewat warna** — status di aplikasi ini tidak pernah
   dibedakan warna saja.

5. **Fanout master splitter bukan fitur tersendiri.** Ia muncul sendiri
   sebagai beberapa garis yang berangkat dari satu simpul `MS`. Jangan
   membuat perhitungan cabang di klien.

6. **`simpul` hanya memuat jangkar kabel** — bukan seluruh 577 ODP. Peta ODP
   dan peta perangkat (`/api/devices/geo`) adalah lapisan lain; jangan
   dicampur ke dalam respons ini.

7. **`lengthM` boleh `null`** — pakai `formatPanjang` seperti biasa, jangan
   tampilkan `0 m`.

#### Yang sudah diurus backend

- **Kabel nonaktif tidak ikut**, dan tidak dilaporkan sebagai masalah.
- **Satu ujung yang menempel di dua tempat berbeda ditolak menggambar**, bukan
  dipilih salah satunya diam-diam. Itu bisa saja benar di lapangan — core
  satu kabel berakhir di ODP berbeda — tapi satu garis lurus tidak bisa
  mewakilinya.
- Semua keputusan itu punya tesnya sendiri di `tests/fiber-geo.test.ts`.

### 22. Riwayat topologi — Fase 16

Tidak ada tabel baru. Seluruh riwayat sudah tertulis di `audit_logs` sejak
Fase 11 — tiap mutasi topologi menulis barisnya **di dalam transaksi yang
sama**, jadi kegagalan audit membatalkan mutasinya. Yang kurang selama ini
cuma cara membacanya.

Ini yang mengisi tab **"Riwayat (History)"** di layar OTB, yang sejak Fase 11
sengaja dibiarkan kosong.

#### GET /api/v1/ftth/riwayat — cukup login

| Parameter | Isi |
|---|---|
| `jenis` + `id` | riwayat satu entitas **beserta yang menempel padanya** |
| `limit` | 1–100, bawaan 30 |
| `sesudah` | penanda halaman, dari `berikutnya` jawaban sebelumnya |

`jenis`: `otb` · `otb_tray` · `otb_port` · `fiber_cable` · `fiber_core` ·
`fiber_termination` · `fiber_closure` · `fiber_splice` · `olt_device`.
Tanpa `jenis`/`id`, jawabannya riwayat **seluruh** topologi.

```jsonc
{
  "baris": [{
    "id": "…",
    "waktu": "2026-08-22T03:11:04.000Z",
    "action": "otb.port.terminated",
    "ringkas": "Core dipasang ke port",   // kalimat siap tampil
    "entityType": "otb_port", "entityId": "…",
    "oleh": "Budi",                        // atau "sistem"
    "detail": { "sebelum": { "status": "kosong" }, "sesudah": { … } }
  }],
  "berikutnya": "2026-08-22T03:10:00.000Z|abc"   // null kalau sudah habis
}
```

`400` untuk `jenis` tak dikenal, `jenis` tanpa `id` (atau sebaliknya), dan
`limit` di luar 1–100.

#### Enam hal yang WAJIB benar

1. **Ruang lingkupnya sudah dikembangkan di server.** `jenis=otb` membawa
   peristiwa tray dan port-nya juga; `jenis=fiber_cable` membawa core,
   terminasi, dan silangannya. Jangan menyaring ulang di klien per
   `entityId` — hasilnya akan menyusut jadi satu baris, dan layar riwayat
   yang selalu berisi satu baris terlihat berfungsi padahal tidak berguna.

2. **`ringkas` sudah kalimat siap tampil.** Jangan menerjemahkan `action`
   sendiri. Kalau tiap layar punya terjemahannya sendiri, dua layar akan
   menjelaskan peristiwa yang sama dengan dua cara — dan yang satu akan salah
   lebih dulu. Kalau ada `action` baru yang belum punya kalimat, ia tampil apa
   adanya; laporkan lewat `PERMINTAAN-FRONTEND-KE-BACKEND.md`, jangan ditambal
   di klien.

3. **Aksi yang tidak dikenal TIDAK disembunyikan** — dan jangan disembunyikan
   di layar juga. Riwayat yang diam-diam membuang peristiwa asing terlihat
   lengkap, dan itu lebih buruk daripada menampilkan kode mentah.

4. **Halaman memakai `sesudah`, bukan nomor halaman.** Penandanya berisi waktu
   **dan** id, karena pemasangan silangan massal menulis beberapa baris pada
   milidetik yang sama — penanda berbasis waktu saja akan melewatkan
   sebagiannya. Kirim `berikutnya` apa adanya; jangan menguraikannya.

5. **`oleh` bisa berbunyi `"sistem"`** untuk aksi worker atau webhook, dan
   `"pengguna terhapus"` kalau akunnya sudah tidak ada. Keduanya bukan galat.

6. **`detail` bentuknya berbeda-beda per `action`.** Ia `jsonb` apa adanya —
   tampilkan sebagai pasangan kunci-nilai, jangan mengandaikan ada
   `sebelum`/`sesudah` pada semua baris.

#### Yang sudah diurus backend

- **Index sudah ada** (`audit_logs_entity_idx`, `audit_logs_created_idx`).
  `audit_logs` append-only dan tidak pernah mengecil; tanpa index, layar
  riwayat melambat terus seiring umur sistem tanpa ada yang tahu kenapa.
- **Riwayat tidak pernah dihapus**, dan tidak ada endpoint yang bisa
  menghapusnya. Terminasi dan silangan yang dilepas pun tetap ada barisnya.

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
- ~~**`/api/devices/:id/metrics-history` seluruhnya dibangkitkan**~~ —
  **SUDAH DITUTUP 22 Agustus.** `bandwidth` kini dibaca dari
  `traffic_samples` untuk perangkat yang punya interface uplink terdaftar, dan
  jawabannya membawa `sumber` (`terukur` · `fixture` · `belum-ada-data`).
  `cpu`, `ram`, dan `suhu` **tetap belum punya sumber** — tapi sekarang
  mengaku `belum-ada-data` dengan `value: null`, bukan angka karangan.
  Tugas T-34.
- ~~**Laporan SLA & trafik di-seed otomatis**~~ — **SUDAH DITUTUP 21 Agustus.**
  Kedua seed kini berhenti begitu LibreNMS terkonfigurasi, jadi produksi tidak
  pernah lagi menerima angka karangan. Yang tersisa: rekapnya memang **belum
  pernah diisi** dari data nyata, dan endpoint mengakuinya lewat
  `source: "belum-ada-data"`. Di mode pengembangan seed tetap jalan supaya
  layar punya isi, dan mengaku `source: "fixture"`.
- ~~**Tiga endpoint belum memeriksa login**~~ — **SUDAH DITUTUP.**
  `/api/dashboard/summary`, `/api/reports/sla`, dan `/api/reports/traffic`
  ketiganya kini memakai `withRole([])`. Catatan lama ini sempat bertahan
  setelah lubangnya ditambal; layar boleh bergantung pada ketiganya seperti
  endpoint lain.
- ~~**⚠️ `GET /api/reports/sla` sedang 500 di PRODUKSI**~~ — **SUDAH
  DIPERBAIKI 21 Agustus.** Penyebabnya seed di atas: baris laporan karangan
  ber-asset ID fixture membentur foreign key `assets` produksi, 24 kali di log
  PM2. `/api/reports/traffic` punya cacat yang sama persis dan belum sempat
  kena. Keduanya kini menjawab 200 dengan `source: "belum-ada-data"`.
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

### ✅ T-40. Layar `/ftth`: cari, saring, dan halaman untuk 580 ODP — frontend selesai 2026-08-22

- **Layar:** `/ftth` — `src/components/operations/ftth-page.tsx`.
- **Butuh:** `GET /api/v1/ftth/odps`, yang sekarang menerima parameter.

Selesai di `/ftth`: pencarian server-side, filter situs/OLT, urutan kode/nama/
kapasitas/port terpakai dengan arah naik/turun, ukuran halaman 20/50/100,
pagination, total hasil dari server, serta peringatan saat respons dipotong.

**Masalahnya bukan beban server — itu penting supaya tidak salah
diperbaiki.** Diukur di produksi: kuerinya **6,6 ms**, payloadnya **148 kB**
untuk 580 ODP. Itu tidak menyakiti apa pun. Yang bermasalah adalah **tidak ada
cara menemukan satu ODP**: 580 baris akordion, tanpa kotak cari, tanpa
penyaring. Teknisi yang mencari satu ODP harus menggulir.

**Parameter baru (semuanya opsional):**

```
q         cari di code DAN name sekaligus
siteId    saring satu situs
oltId     saring satu OLT
sort      code | name | capacity | usedPorts     (default code)
dir       asc | desc                              (default asc)
page      halaman, 1-basis
pageSize  20 | 50 | 100
```

**Jawaban:**

```jsonc
{
  "odps": [ /* bentuk tiap barisnya tidak berubah */ ],
  "total": 580,            // sesudah q/siteId/oltId, SEBELUM halaman
  "page": 1,
  "pageSize": 20,
  "halamanTerakhir": 29,
  "terpotong": false       // true kalau mode lama memotong diam-diam
}
```

**Yang penting:**

1. **Layar sekarang tidak akan pecah.** Tanpa `page` maupun `pageSize`,
   jawabannya tetap seperti dulu — seluruh ODP sampai 2.000 baris. Disengaja
   supaya `/ftth` tidak diam-diam kehilangan 560 dari 580 barisnya di antara
   deploy backend dan pembaruan layar. Begitu kamu kirim `page` atau
   `pageSize`, mode itu berhenti.
2. **Pencariannya WAJIB lewat `q` ke server, jangan `filter()` di browser.**
   Penyaringan di browser hanya menyaring yang TERKIRIM. Begitu paginasi
   dipakai, hasil pencarian jadi tidak lengkap tanpa ada yang tahu — persis
   kebohongan halus yang sudah dicabut dari layar PPPoE di T-28.
3. **`total` adalah jumlah SESUDAH penyaringan, sebelum halaman.** Lencana
   "580 ODP" di kepala layar harus membaca `total`, bukan `odps.length` —
   yang kedua akan berbunyi "20 ODP" begitu paginasi menyala.
4. **`terpotong: true` wajib ditampilkan** kalau sampai muncul. Ia berarti
   jawabannya dipotong di 2.000 baris tanpa paginasi.

**Isian dropdown penyaring:** situs dari `GET /api/v1/sites` yang sudah kamu
pakai; OLT dari `GET /api/v1/ftth/olts`. Di produksi hari ini: **5 situs**
(3 ODP tanpa situs) dan **6 OLT** — cukup kecil untuk dropdown biasa.

### ✅ T-39. Chip ringkasan ONU: jangan diam-diam melewatkan status yang tak dikenal — frontend selesai 2026-08-22

- **Layar:** `/console` — `src/components/operations/onu-list-panel.tsx`, plus
  `src/types/operations.ts`.
- **Butuh:** tidak ada endpoint baru. Kontraknya tidak berubah.

Selesai: chip fase yang dikenal tetap tampil lebih dulu, lalu seluruh kunci
`ringkas` yang belum dikenal ikut ditampilkan dengan nada informasi dan label
mentahnya. Tipe `OnuPhaseState` sekarang menerima status string dari perangkat.

**Yang terjadi sekarang.** Ringkasannya merender daftar tetap:

```ts
const ONU_PHASES: OnuPhaseState[] = ["working", "DyingGasp", "LOS", "syncMib"];
…
{ONU_PHASES.map((phase) => <NocStatus label={`${phaseLabel(phase)}: ${result.ringkas[phase] ?? 0}`} … />)}
```

Tapi `ringkas` dari server berisi **apa pun yang dikatakan perangkat** — ia
dihitung dari `phaseState` mentah, bukan dari daftar yang kita kenal. ZTE di
lapangan juga mengenal `offline`, `authing`, dan `LOSi`.

**Seberapa parah — jangan dibesar-besarkan.** Barisnya sendiri sudah aman:
`phaseTone` jatuh ke `info` dan `phaseLabel` mengembalikan nilai mentahnya,
jadi status asing tetap tampil apa adanya di tabel tanpa crash. Yang bolong
hanya **ringkasannya**: chip-nya tidak akan menjumlah ke `total`, mis. tertulis
324 + 15 + 2 = 341 padahal `total` 356, dan selisih 15 itu tidak dijelaskan di
mana pun.

**Yang diminta:**

1. Sesudah keempat chip yang dikenal, render juga kunci `ringkas` yang **tidak**
   ada di `ONU_PHASES`, pakai `phaseTone`/`phaseLabel` yang sudah ada — nada
   `info` dan label mentah sudah perilaku yang benar untuk status asing.
2. Longgarkan `OnuPhaseState` di `src/types/operations.ts` supaya jujur
   terhadap kontraknya, mis.:

   ```ts
   export type OnuPhaseState = "working" | "DyingGasp" | "LOS" | "syncMib" | (string & {});
   ```

   Server memang mengirim `string`; union tertutup menyatakan jaminan yang
   tidak pernah diberikan backend.

**Kenapa ini layak dikerjakan padahal jarang kejadian:** ringkasan yang tidak
menjumlah ke total adalah bentuk salah yang paling mahal di portal ini —
terlihat lengkap, tidak melempar galat, dan baru ketahuan saat seseorang
menghitung manual. Sama persis dengan 15 ONU yang raib di balik `--More--`.

### ✅ T-38. Output konsol mentah: jangan tumpahkan ratusan baris sekaligus — frontend selesai 2026-08-22

- **Layar:** `/console` — `src/components/operations/console-page.tsx`.
- **Butuh:** tidak ada endpoint baru. Murni tampilan.

Selesai di `/console`: output sekarang berada di `<pre>` dengan tinggi tetap dan
gulir sendiri, kepala hasil menampilkan jumlah baris serta ukuran byte, kotak
pencarian memberi jumlah kecocokan, dan keluaran di atas 50 baris dimulai dari
potongan yang eksplisit menyebut jumlah baris tersembunyi. Isi keluaran tetap
ditampilkan sebagai teks mentah; penanda pencarian tidak mengubah isinya.

**Masalahnya terukur.** Satu perintah `show gpon onu state` di
ZTE-C300-102-Pesagi menjawab **21.589 karakter / 356 baris**, dan `<pre>` di
layar itu menumpahkan semuanya sekaligus.

**Yang diminta:**

1. Beri `<pre>`-nya tinggi tetap dengan gulir sendiri, jangan biarkan halaman
   ikut memanjang.
2. Sebutkan ukurannya di kepala panel — mis. "356 baris · 21 KB". Orang perlu
   tahu apa yang dia hadapi sebelum menggulir.
3. Kotak **cari di dalam output**, dengan penanda jumlah kecocokan.
4. Kalau lebih dari ±50 baris, tampilkan sebagian dulu + tombol "Tampilkan
   semua". Jangan memotong diam-diam — sebutkan berapa yang disembunyikan.

**Yang TIDAK boleh diubah: isinya.** Panel itu sengaja menampilkan jawaban
perangkat apa adanya supaya bisa ditelusuri — jangan mengurai, merapikan
kolom, atau membuang baris yang terlihat tidak penting. Yang berubah cuma
cara menampungnya di layar.

Kalau butuh daftar ONU terurai yang bisa disaring, itu T-37 di bawah — layar
terpisah, bukan pengganti panel ini.

### ✅ T-37. Layar daftar ONU per OLT — frontend selesai 2026-08-22

- **Layar:** baru. Saran tempat: tab di `/console`, atau di `/devices/[id]`
  untuk perangkat ber-grup OLT. Pilihanmu.
- **Butuh:** `POST /api/v1/devices/onu` (baru).

Selesai sebagai panel kedua di `/console`: pilihan OLT, pencarian indeks/port,
filter status, ukuran halaman 20/50/100, pagination, ringkasan status dari
respons server, perintah yang dijalankan, serta peringatan `takTerurai` sudah
tersedia. Permintaan hanya dikirim setelah klik pengguna; 501 ditampilkan
sebagai perangkat yang tidak mendukung daftar ONU, bukan daftar kosong, dan
429 tidak dicoba ulang otomatis.

**Kenapa POST dan bukan GET:** endpoint ini MEMBUKA SESI TELNET ke perangkat
produksi. GET bisa terpicu prefetch peramban atau pratayang tautan, dan itu
membuka sesi tanpa ada yang memintanya. Panggil dengan `sendJson("POST", …)`,
jangan `useSWR` bergaya GET.

**Permintaan:**

```jsonc
{
  "oltId": "…",            // wajib — dari GET /api/v1/ftth/olts
  "q": "1/2/3",            // opsional — cocok pada indeks atau port PON
  "status": "tidak-sehat", // opsional — "tidak-sehat" | "LOS" | "DyingGasp" | "working" | "syncMib"
  "halaman": 1,
  "ukuran": 50             // 20 · 50 · 100; di luar itu jatuh ke 50
}
```

**Jawaban:**

```jsonc
{
  "olt": { "id": "…", "name": "ZTE-C300-102-Pesagi", "vendor": "ZTE" },
  "perintah": "show gpon onu state",   // tampilkan — orang berhak tahu apa yang dijalankan
  "ringkas": { "working": 324, "DyingGasp": 15, "LOS": 2 },
  "total": 341,            // seluruh ONU pada OLT ini
  "totalTersaring": 17,    // sesudah q + status
  "halaman": 1,
  "ukuran": 50,
  "halamanTerakhir": 1,
  "baris": [
    {
      "indeks": "1/2/3:7",     // apa adanya dari perangkat
      "ponPort": "1/2/3",
      "onuId": 7,
      "adminState": "enable",
      "omccState": "disable",
      "phaseState": "LOS",     // working · DyingGasp · LOS · syncMib
      "keterangan": "1(GPON)",
      "sehat": false           // hanya `working` yang sehat
    }
  ],
  "takTerurai": []
}
```

**Aturan yang mahal kalau dilanggar:**

1. **`ringkas` dihitung dari SELURUH ONU, bukan dari halaman yang tampil.**
   "2 LOS" harus tetap 2 walau halaman ini tidak memuat satu pun. Jangan
   hitung ulang dari `baris`.
2. **`takTerurai` WAJIB ditampilkan kalau terisi** — mis. peringatan "3 baris
   tidak terbaca". Isinya baris yang jelas-jelas baris ONU tapi gagal diurai.
   Menyembunyikannya membuat daftar yang kehilangan isi terlihat persis
   seperti daftar yang utuh. Ini bukan hipotetis: sebelum sisa `--More--`
   dibersihkan, **15 dari 356 ONU raib tanpa satu galat pun**.
3. **`keterangan` jangan diberi judul yang menyatakan artinya.** C300
   menuliskannya `Channel` (`1(GPON)`), C600 menuliskannya `Speed mode`. Beri
   judul netral seperti "Keterangan".
4. **HSGQ menjawab 501, dan itu jawaban yang benar — bukan galat kita.**
   Bodinya memuat `alasan`; tampilkan kalimat itu. HSGQ-G008 tidak punya
   daftar ONU di vty-nya sama sekali — ditanyakan langsung ke perangkatnya,
   `show ?` hanya menjawab history, memory, startup-config, version. **Jangan
   tampilkan daftar kosong**: itu terbaca sebagai "OLT ini tidak punya ONU",
   yang keliru.
5. **429 berarti batas laju, dan anggarannya DIBAGI dengan layar konsol** —
   20 sesi telnet per pengguna per menit untuk keduanya bersama-sama. Jangan
   memanggil ulang otomatis saat kena 429.

**Skala nyatanya hari ini:** 341 ONU (C300 Pesagi), 369 (C600 Kecicang), 198
(C600 Abang) — 908 di tiga OLT. Halaman bawaan 50.

### ✅ T-36. Grid optik OLT: sebutkan sumbernya, dan tangani daya pancar kosong — frontend selesai 2026-08-22

- **Layar:** `/devices/[id]` — `src/components/devices/optical-health.tsx`.
- **Butuh:** `GET /api/devices/:id/olt-optics` dan `GET /api/devices/:id/live`,
  keduanya sekarang mengirim dua field baru.

**Apa yang berubah di backend (22 Agustus 2026).**

1. **`OltOpticsResponse.sumber`** bernilai `terukur` · `fixture` ·
   `belum-ada-data`, dan **`catatan`** terisi saat `belum-ada-data` — sudah
   berupa kalimat siap tampil. Persis pola `sumber`/`catatan` yang sudah kamu
   pakai di T-34, jadi `ReportSourceBanner` bisa langsung dipakai ulang.

2. **`PonPortHealth.txPower` sekarang `number | null`.** `null` berarti
   sensornya tidak menjawab.

**Kenapa ini penting, bukan sekadar rapi.**

Sampai kemarin setiap OLT yang tidak terpetakan ke LibreNMS diisi
`generateOpticalHealth()` — deret tiruan, tanpa apa pun di payload yang
mengatakannya. Di produksi itu berarti **`HSGQ-100-Kecicang` menampilkan 4
port PON dengan daya pancar karangan** (+3,7 dBm dan seterusnya). Perangkat
itu justru yang diputuskan dibaca lewat konsol CLI dan memang tidak akan
pernah punya data LibreNMS, jadi karangannya permanen. Sekarang ia mengirim
`ports: []` dengan `sumber: "belum-ada-data"` dan alasannya.

Keadaan hari ini: **keenam OLT menjawab `belum-ada-data`** — lima karena
LibreNMS belum melaporkan sensor kelas `dbm` sama sekali, satu karena tidak
terdaftar di sana. Jadi gridnya memang kosong, dan itu benar.

**Yang diminta:**

1. Tampilkan penanda `sumber` + `catatan` di kepala kartu, seperti T-34.
   Blok `ports.length === 0` yang sudah ada sekarang punya kalimat yang bisa
   dipakai — ambil dari `catatan`, jangan tulis sendiri.
2. **`txPower` null jangan dirender sebagai angka.** Baris ini di
   `optical-health.tsx` akan menulis `+null`:

   ```tsx
   +{pon.txPower}
   ```

   Tampilkan `—` atau "tidak terbaca". **Jangan `?? 0`-kan.** Nol dBm adalah
   1 mW — pembacaan optik yang sangat kuat. "Tidak diketahui" yang digambar 0
   tidak sekadar meleset, ia tampil sebagai kondisi terbaik yang mungkin,
   tepat pada layar yang dipakai orang untuk mencari redaman.
3. Awalan `+` yang di-hardcode itu juga keliru untuk dBm negatif — daya pancar
   PON yang sehat justru bernilai negatif (mis. −18,4 dBm). Biarkan tandanya
   ikut angkanya.

**Implementasi frontend selesai:** grid memakai `ReportSourceBanner`, alasan
`catatan` dari server terlihat saat port kosong, dan `txPower: null` tampil
sebagai "—". Nilai daya pancar tidak lagi diberi awalan `+` secara paksa,
sehingga tanda negatif dari respons server tetap benar.

### ✅ T-35. Kartu suhu: bedakan "tidak punya sensor" dari "memuat" — frontend selesai 2026-08-22

- **Layar:** `/devices/[id]` — `src/components/devices/temperature-card.tsx`.
- **Butuh:** tidak ada endpoint baru. Yang berubah cuma tipenya.

**Apa yang berubah di backend (22 Agustus 2026).**
`DeviceMetricsResponse.temperature` sekarang `TemperatureReading | null`.
Sebelumnya perangkat tanpa sensor suhu dikirim sebagai
`{ celsius: 0, status: "normal" }` — nol derajat, berlencana hijau "Normal".
Itu bukan pembacaan yang meleset; itu pembacaan yang **tidak pernah ada**,
ditampilkan sebagai kabar baik. Banyak switch akses memang tidak punya sensor
suhu sama sekali.

**Kenapa ini tugasmu.** Kartunya sudah menjaga nilai kosong:

```tsx
if (!reading) {
  return <div …>Memuat metrik…</div>;
}
```

Jadi tidak ada yang pecah — tapi sekarang kalimatnya salah. Perangkat tanpa
sensor akan berbunyi **"Memuat metrik…" selamanya**, dan orang akan menunggu
sesuatu yang tidak akan pernah datang. "Sedang dimuat" dan "tidak ada
sensornya" adalah dua keadaan berbeda dan harus terbaca berbeda.

**Yang diminta:**

1. Pisahkan dua keadaan itu. Selama `metrics` belum ada → "Memuat metrik…".
   Kalau `metrics` sudah ada tapi `metrics.temperature === null` → kalimat
   yang menjelaskan, mis. *"Perangkat ini tidak melaporkan sensor suhu."*
2. **Jangan menampilkan angka apa pun** pada keadaan kedua — tidak `0`, tidak
   `—°C` yang terlihat seperti bacaan. Tidak ada lencana status: `normal` /
   `tinggi` / `kritis` semuanya adalah klaim tentang suhu yang tidak diketahui.
3. Ambang `Tinggi ≥ … · Kritis ≥ …` di kaki kartu boleh tetap ditampilkan
   atau disembunyikan — pilihanmu, asal tidak terbaca sebagai penilaian atas
   perangkat ini.

**Jangan** menutupnya dengan `?? 0` di frontend. Itu persis kesalahan yang
baru saja dicabut dari backend, dan memindahkannya satu lapis ke atas membuat
ia lebih sulit ditemukan, bukan hilang.

**Implementasi frontend selesai:** kartu membedakan metrik yang belum tersedia
(`Memuat metrik…`) dari respons `temperature: null` ("Perangkat ini tidak
melaporkan sensor suhu."). Keadaan tanpa sensor tidak menampilkan angka,
lencana status, atau ambang suhu.

### ✅ T-34. Grafik riwayat perangkat mengaku sumbernya — frontend selesai 2026-08-22

- **Layar:** `/devices/[id]` — `src/components/devices/history-chart.tsx`.
- **Butuh:** `GET /api/devices/:id/metrics-history` (§5), yang sekarang
  mengirim dua field baru.

**Ada perubahan kontrak yang akan memecah grafik kalau diabaikan:**

1. **`points[].value` sekarang `number | null`.** `null` berarti tidak ada
   pengukuran pada rentang itu — **bukan nol**. Nol berarti "trafiknya
   berhenti"; null berarti "kami tidak tahu". Recharts menggambar `null`
   sebagai putus garis kalau nilainya benar-benar `null`; kalau kamu
   `?? 0`-kan, layar akan melaporkan gangguan yang tidak pernah terjadi.

2. **`sumber`** bernilai `terukur` · `fixture` · `belum-ada-data`.
   Tampilkan penandanya — pola yang sama dengan `ReportSourceBanner` yang
   sudah kamu buat untuk laporan. `catatan` terisi saat `belum-ada-data` dan
   sudah berupa kalimat siap tampil.

3. **`titikTerukur`** menyebut berapa titik yang benar-benar punya
   pengukuran. Berguna untuk "12 dari 96 titik terukur".

4. **Grafik CPU/RAM juga ikut**, di `src/components/devices/cpu-ram-chart.tsx`.
   `UsagePoint.cpu` dan `.ram` kini `number | null` — sebelumnya nilai yang
   tidak terbaca disimpan sebagai `0`, dan garis datar 0% terbaca sebagai
   "perangkat ini nyaris tidak memakai memori" alih-alih "sensornya tidak
   menjawab". Recharts sudah menggambar putus garis dengan benar; yang perlu
   diperbaiki cuma `formatter={(value) => [\`${value}%\`]}` yang akan menulis
   `null%` kalau tooltip-nya sampai terpanggil pada titik kosong.

**Keadaan hari ini, supaya tidak dikira bug:**

| Metrik | Perangkat | Sumber |
|---|---|---|
| `bandwidth` | router distribusi | **terukur** — dari `traffic_samples` |
| `bandwidth` | 6 OLT | `belum-ada-data` — belum punya interface uplink terdaftar |
| `cpu`, `ram`, `suhu` | yang ada di LibreNMS | **terukur** — dari `device_metric_samples`, sejak 22 Agustus 2026 |
| `cpu`, `ram`, `suhu` | HSGQ-100-Kecicang | `belum-ada-data` — tidak mendukung SNMP, dibaca lewat konsol CLI |
| `suhu` | perangkat tanpa sensor suhu | `belum-ada-data` — memang tidak punya sensornya |

**Yang berubah 22 Agustus:** CPU, RAM, dan suhu sekarang punya sumber
tersimpan. Pekerjaan berjadwal `metrics.poll` mencuplik ketiganya tiap 5 menit
ke tabel `device_metric_samples`, dan `metrics.prune` membuang yang lebih tua
dari 30 hari. Sebelum ini ketiganya selalu menjawab `belum-ada-data`.

Konsekuensi untuk layar: **grafik baru terisi setelah worker berjalan
beberapa putaran.** Perangkat yang baru didaftarkan akan kosong selama
5–10 menit pertama, dan itu benar — bukan bug. Rentang 24 jam baru penuh
setelah sehari.

Sisanya tetap **kosong dengan penjelasan**. Itu benar, dan lebih baik daripada
sebelumnya: sampai 22 Agustus semuanya berisi angka yang tidak pernah diukur,
tanpa ada yang bisa membedakan.

**Satu jebakan yang khusus mengenai suhu:** kartu suhu di layar perangkat
(bukan grafik ini) masih memakai `sensorsToTemperature(sensors) ?? { celsius:
0, status: "normal" }` — perangkat tanpa sensor suhu ditampilkan **0 °C
"normal"**. Itu kesalahan yang sama dengan `?? 0` di atas, dan sudah dicatat
untuk diperbaiki di sisi backend; jangan menirunya di grafik.

**Implementasi frontend selesai:** `history-chart.tsx` menampilkan banner
sumber, jumlah titik terukur, dan `catatan` dari server. Nilai `null` tetap
dikirim ke Recharts agar garis terputus, bukan diubah menjadi nol. Grafik
CPU/RAM live juga menampilkan tanda `—` dan tooltip "Belum ada pengukuran"
untuk sensor yang tidak terbaca.

### ✅ T-33. Tab Riwayat — layar OTB, kabel, dan closure — frontend selesai 2026-08-22

Frontend menambahkan timeline audit topologi reusable di OTB, kabel, dan
closure. Tab Riwayat OTB kini membaca endpoint §22; tiap baris menampilkan
waktu, `ringkas`, pelaku, dan detail expandable. Tombol "Muat lebih banyak"
mengirim cursor `berikutnya` melalui `sesudah`, tanpa menyaring ulang ruang
lingkup yang sudah dikembangkan server. Action yang belum dikenal tetap
terlihat melalui `ringkas` dan kode action mentah di detail.

- **Komponen:** `src/components/operations/topology-history.tsx` menjadi satu
  sumber perilaku pagination, refresh, state error/empty, dan detail audit.

- **Layar:** tab **"Riwayat (History)"** di `/ftth/otb/[id]` yang sejak Fase 11
  berbunyi *"belum tersedia pada kontrak endpoint OTB"*. Sekarang tersedia.
  Panel serupa layak juga di `/ftth/cables/[id]` dan `/ftth/closures/[id]`.
- **Butuh:** §22 — satu endpoint, `GET /api/v1/ftth/riwayat?jenis=otb&id=…`.
- **Bentuknya:** garis waktu terbalik — terbaru di atas. Tiap baris: waktu,
  `ringkas`, pelakunya, dan `detail` yang bisa dibuka.
- **Halaman:** tombol "muat lebih banyak" memakai `berikutnya`. **Jangan**
  nomor halaman — riwayat bertambah dari atas, jadi nomor halaman menggeser
  isinya di antara dua klik.
- **Jangan menyaring ulang per `entityId` di klien.** Server sudah
  mengembangkan ruang lingkupnya; menyaring lagi akan menyisakan satu baris.
- **Jangan menerjemahkan `action` sendiri** — pakai `ringkas`.
- **Kenapa sekarang:** ini tab terakhir yang masih berbunyi "belum tersedia",
  dan riwayatnya sudah terisi sejak OTB contoh dibuat.

### ✅ T-32. Lapisan jalur fiber di peta — frontend selesai 2026-08-22

Frontend menambahkan filter lapisan feeder/distribution, garis dengan urutan
GeoJSON yang dibalik ke format Leaflet, penanda simpul, dan panel daftar
`tanpaGeometri` beserta alasannya. Kabel yang belum punya geometri tidak pernah
digambar sebagai garis perkiraan.

- **Layar:** `/map` — tambahkan lapisan fiber di atas peta yang sudah ada.
- **Butuh:** §21 — satu endpoint, `GET /api/v1/ftth/geo`.
- **Bentuknya:** garis untuk tiap kabel, penanda untuk OTB / closure / MS /
  ODP, dan **panel "Belum bisa digambar"** berisi `tanpaGeometri` lengkap
  dengan alasannya.
- **Jebakan yang paling mungkin:** `koordinat` datang dalam urutan GeoJSON
  `[lon, lat]`, sedangkan Leaflet mau `[lat, lng]`. Tertukar tidak
  menghasilkan galat — kabelnya cuma pindah ke laut.
- **Filter minimal:** feeder / distribution, dan togel untuk lapisan fiber
  supaya peta perangkat yang sudah ada tetap bisa dilihat sendirian.
- **Kenapa sekarang:** produksi sudah punya satu jalur contoh yang bisa
  digambar (OTB → closure → MS → dua ODP), jadi hasilnya langsung terlihat
  benar atau salah.

### ✅ T-31. Dua sisa dari tinjauan T-28 sampai T-30 — frontend selesai 2026-08-22

Riwayat terminasi layar kabel kini memakai endpoint per-kabel satu kali dan
kotak cari PPPoE menunda nilai URL sekitar 300 ms tanpa menunda input operator.

**1. Riwayat terminasi: satu permintaan per kabel, bukan per core.**
`fiber-page.tsx:81` memanggil `/cores/:id/terminations` di dalam `Promise.all`
untuk setiap core. Kabel 24 core = 24 permintaan HTTP; kabel 288 core = 288 —
masing-masing dengan join lima tabel.

**Itu kesalahan rancangan saya, bukan kamu.** Endpoint per-kabel memang belum
ada waktu kamu mengerjakannya. Sekarang ada:
`GET /api/v1/ftth/cables/:cableId/terminations` (§17) — satu permintaan, satu
kueri, bentuk baris sama persis ditambah `coreId` dan `coreNumber`, dan
**sudah terurut per nomor core lalu waktu**, jadi `.sort()` di klien bisa
dibuang juga.

**2. Kotak cari PPPoE belum di-debounce.**
`pppoe-page.tsx` menaruh `query` langsung ke kunci SWR, jadi mengetik
"pel005" mengirim **enam permintaan**, masing-masing menjalankan `count(*)`
plus kueri halaman di 1.611 baris. Seluruh tujuan T-28 adalah mengurangi beban
itu.

Tunda ~300 ms sebelum `query` masuk ke kunci SWR. Yang penting: **hanya nilai
untuk URL yang ditunda** — isi kotaknya harus tetap berubah seketika saat
diketik. Saringan router dan pemilih baris tidak perlu ditunda; keduanya
sekali klik.

### ✅ T-30. Tiga perbaikan kecil dari tinjauan kode FTTH — frontend selesai 2026-08-22

Semuanya kecil, dan **tidak satu pun kesalahan besar** — layar FTTH-mu lolos
seluruh aturan mahal di §16–§19. Ini sisa-sisanya.

**1. Cabang trace tidak dipilih ulang saat titik awal berganti.**
`trace-panel.tsx:77` — `branchIndex` hanya diubah lewat klik tab, tidak pernah
kembali ke 0 saat `source` berganti. Telusuri port dengan 5 cabang, pilih
cabang 4, lalu telusuri port lain yang cuma punya 1 cabang: `useMemo` menjepit
indeksnya sehingga isinya benar, tapi **tidak ada tab yang tersorot** — dan
operator melihat jalur yang tidak dia pilih. Reset `branchIndex` ke 0 saat
`source.id` berubah.

**2. `segmenBerulang` belum ditampilkan** (§19 aturan 6).
Ada di `src/types/operations.ts:311` tapi tidak dirender di mana pun. Kalau
sebuah jalur keluar lewat satu core dan kembali lewat core lain pada kabel yang
SAMA, panjangnya memang dihitung dua kali — itu benar, cahayanya memang
menempuh dua kali. Tanpa penanda, angkanya terlihat seperti salah hitung dan
orang akan "memperbaikinya". Tampilkan catatan kecil saat `segmenBerulang > 0`.

**3. Pakai `formatPanjang`, jangan salin rumusnya.**
Konversi meter→kilometer sekarang tersalin di `fiber-page.tsx:69` dan
`trace-panel.tsx:18`. Saya sudah menambahkan `formatPanjang(meter, lengkap?)`
di `src/lib/noc-format.ts` — ia menangani `null` sebagai "Belum diukur",
membedakannya dari `0 m`, dan memberi awalan `≥` saat `lengkap: false`. Sudah
bertes di `tests/noc-format-panjang.test.ts`.

Itu kelalaian saya: aturan "jangan bikin pembagi sendiri" saya tulis untuk
satuan trafik, tapi helper untuk panjang tidak pernah saya sediakan. Sekarang
ada.

### ✅ T-28. Tabel sesi PPPoE — saringan, urutan, dan halaman — frontend selesai 2026-08-22

- **Layar:** `/pppoe` — `src/components/operations/pppoe-page.tsx`.
- **Butuh:** §20. Endpoint sudah hidup dan bertes.
- **Bentuknya:** tabel dengan kolom Username, IP, Caller ID, Uptime, Router,
  Terlihat. Kepala kolom bisa diklik untuk mengurut (naik/turun), kotak cari
  di atas, dropdown router, dan pemilih **20 / 50 / 100** baris.
- **Wajib:** kirim `page` dan `pageSize` di setiap permintaan. Tanpa itu layar
  menarik ~1.600 baris tiap muat — dan itu justru masalah yang tugas ini
  selesaikan.
- **Jangan menyaring atau mengurut di browser.** Semuanya sudah dikerjakan
  database; menyaring ulang di klien hanya menyaring dua puluh baris yang
  kebetulan ada di tangan.
- **Ubah saringan/urutan → kembali ke halaman 1.**
- **Mobile:** kartu, bukan tabel enam kolom.
- **Kenapa sekarang:** produksi punya 1.603 sesi. Setiap pembukaan halaman
  mengirimkan semuanya, dan pencarian di browser sudah mulai berbohong halus.

### ✅ T-29. Trafik di dasbor tampil dalam satuan yang bisa dibaca — frontend selesai 2026-08-22

- **Layar:** `/dashboard` — `src/components/dashboard/network-telemetry.tsx`,
  fungsi `formatTrafficRate` di baris 86–89.
- **Masalahnya:** ia merender `bps` mentah, jadi uplink 3 Gbps tampil sebagai
  `3.034.700.000 bps`. Tidak ada yang bisa membaca itu sekilas, dan itulah
  satu-satunya cara angka trafik dipakai di dasbor.
- **Perbaikannya sudah tersedia sejak §14:** `formatBitrate` di
  `src/lib/noc-format.ts`. Ia menskala sendiri (bps → kbps → Mbps → Gbps),
  memakai pemisah ribuan Indonesia, memberi `—` untuk `null`, dan **tidak**
  mengubah `0` jadi `—`. Sudah bertes di `tests/noc-format-bitrate.test.ts`,
  termasuk nilai uplink produksi 3.034.700.000 → `3,03 Gbps`.
- **Ganti isi `formatTrafficRate` dengan `formatBitrate`** — satu baris.
  Fungsi itu sudah ada sejak 20 Agustus dan sampai hari ini tidak dipakai
  satu tempat pun; itu kelalaian kontrak dari pihak saya, bukan kesalahanmu.
- **Satuannya sudah diputuskan pemilik 21 Agustus 2026: penskalaan otomatis,
  dan Gbps boleh muncul.** Jadi uplink tampil `3,03 Gbps`, bukan
  `3.034,7 Mbps`. Tidak perlu menanyakannya lagi, dan tidak perlu membuat
  varian Mbps-tetap.
- **Jangan membuat pembagi sendiri di komponen.** Satuan trafik punya satu
  sumber, `formatBitrate`; panjang kabel punya `formatPanjang`. Komponen yang menghitung `value / 1000000` sendiri
  akan berbeda dari yang lain begitu ada yang memperbaiki pembulatan di satu
  tempat saja.
- **Periksa juga tempat lain** yang menulis satuan tangan:
  `traffic-report.tsx`, `port-bandwidth.tsx`, dan `history-chart.tsx`
  sudah memakai "Mbps" sebagai teks tetap. Itu sah kalau nilainya memang sudah
  dalam Mbps — pastikan saja, jangan diubah asal.

### ✅ T-27. Layar trace jalur core — frontend selesai 2026-08-21

- **Layar:** tab **"Peta Jalur"** dan **"Detail Core"** di `/ftth/otb/[id]`
  yang selama ini sengaja dibiarkan kosong — sekarang datanya ada.
- **Butuh:** §19 — satu endpoint, `GET /api/v1/ftth/trace`.
- **Bentuknya:** ikuti `docs/gambar/otb-detail-core.jpeg`:
  - **"Jalur Singkat Core"** — stepper vertikal dari `langkah[]`, dengan jarak
    per hop.
  - **"Rincian Panjang Jalur"** — tabel per segmen + TOTAL dari `ringkas`.
  - **"Informasi Output (Akhir Jalur)"** — langkah terakhir.
  - **"Silangan Core"** — langkah ber-`jenis: "SILANGAN"`.
- **Percabangan splitter:** kalau `jalur.length > 1`, tampilkan pemilih cabang
  atau daftar — jangan menampilkan yang pertama saja.
- **Status non-LENGKAP harus terlihat**, dengan `diagnosis` ditampilkan apa
  adanya.
- **Kenapa sekarang:** ini yang membuat seluruh Fase 11–13 berguna bagi
  teknisi. Tanpa layar ini, datanya ada tapi tidak ada yang bisa membacanya
  saat gangguan jam tiga pagi.
- **Kenapa tidak bisa diakali dari backend:** murni tampilan. Trace, diagnosis,
  penjumlahan panjang, dan estimasi rugi semuanya dihitung di server.

### ✅ T-26. Layar closure dan matriks silangan core — frontend selesai 2026-08-21

- **Layar:** `/ftth/closures` (daftar) dan `/ftth/closures/[id]` (matriks).
- **Butuh:** §18 — lima endpoint, semuanya sudah hidup dan bertes.
- **Bentuknya:** ikuti tabel "Silangan Core (Closure/Joint)" di
  `docs/gambar/otb-detail-core.jpeg` — kolom masuk (kabel/core/warna), keluar
  (kabel/core/warna), penanda silang, estimasi rugi, alasan, tanggal.
- **Alur pemasangan:** susun baris → **pratinjau** → tampilkan verdict per
  baris → commit. Kalau commit `409`, tampilkan bahwa **tidak ada** yang
  tersimpan.
- **Riwayat wajib ada togelnya** (`?riwayat=1`). Yang sudah dilepas justru yang
  dicari saat gangguan.
- **Mobile: kartu, bukan tabel.** Delapan kolom tidak muat di 375 px, dan
  layar ini dipakai sambil berdiri di tiang.
- **Kenapa sekarang:** tabelnya sudah ada dan kosong. Fase 14 (trace) menyusuri
  silangan ini; tanpa cara memasukkannya, mesin trace tidak punya apa pun
  untuk ditelusuri.
- **Kenapa tidak bisa diakali dari backend:** murni tampilan. Seluruh aturan —
  larangan membagi, okupansi ujung core, atomisitas batch — sudah ditegakkan
  di server, sebagian langsung oleh PostgreSQL.

### ✅ T-25. Layar kabel, core, dan terminasi — frontend selesai 2026-08-22

- **Layar:** `/ftth/cables` (daftar) dan `/ftth/cables/[id]` (detail + tabel
  core). Plus aksi terminasi dari layar OTB yang sudah ada.
- **Butuh:** §17 — lima endpoint, semuanya sudah hidup dan bertes.
- **Bentuknya:** daftar kabel dengan kategori, panjang, dan hitungan core;
  detail menampilkan tabel core (nomor, warna, peruntukan, status, ujung mana
  yang terpakai). Pola tabel yang sama dengan `/ftth`.
- **Aksi terminasi:** dari tab "Inventori Tray" di layar OTB, sebuah port
  kosong bisa ditautkan ke satu ujung core. Wajib mengisi alasan.
- **Riwayat wajib terlihat.** Terminasi yang sudah dilepas tetap ada di
  database dan harus bisa dilihat — itu justru yang dicari orang saat
  gangguan. Jangan hanya menampilkan yang aktif.
- **Kenapa sekarang:** tabelnya sudah ada dan kosong. Tanpa layar ini tidak
  ada cara memasukkan kabel, jadi Fase 13 (closure dan silangan core) tidak
  punya apa pun untuk disilangkan.
- **Kenapa tidak bisa diakali dari backend:** murni tampilan. Seluruh aturan —
  okupansi, peruntukan core, alasan wajib — sudah ditegakkan di server, dan
  sebagian ditegakkan langsung oleh PostgreSQL.

### ✅ T-24. Layar OTB — daftar, tray, dan inventori port — frontend selesai 2026-08-22

- **Layar:** `/ftth/otb` (daftar) dan `/ftth/otb/[id]` (detail). Entri nav baru
  di `src/components/layout/noc-shell.tsx`, di bawah "FTTH".
- **Butuh:** §16 — empat endpoint, semuanya sudah hidup dan sudah bertes.
- **Bentuknya:** ikuti `docs/gambar/otb-detail-*.jpeg`. Bagian yang bisa dibuat
  sekarang: dropdown "Pilih OTB", baris pemilih tray berlencana status, panel
  Tipe Konektor / Polish, dan tab **Inventori Tray** (tabel port dengan status,
  external service ID, dan catatan — pola yang sama dengan `/ftth`).
- **Riwayat audit port tetap kosong dengan penjelasan.** "Peta Jalur" dan
  "Detail Core" sekarang memakai data trace yang sudah tersedia dari fase
  berikutnya; jangan mengisi riwayat audit dengan angka contoh karena endpoint
  audit port belum ada.
- **Kenapa sekarang:** tabelnya sudah ada dan kosong. Tanpa layar ini tidak ada
  satu pun cara memasukkan OTB, jadi seluruh Fase 12 (core dan terminasi) tidak
  punya tempat untuk menambatkan diri.
- **Kenapa tidak bisa diakali dari backend:** ini murni pekerjaan tampilan.
  Seluruh aturan domain — penomoran global, lencana tray, penolakan penurunan
  kapasitas — sudah ditegakkan di server dan tidak boleh diulang di layar.

### ✅ T-23. Laporan yang kosong harus terlihat kosong — frontend selesai 2026-08-22

- **Layar:** `/reports` — `src/components/reports/sla-report.tsx` dan
  `traffic-report.tsx`.
- **Butuh:** §7, field `source` yang baru.
- **Kenapa sekarang:** sampai 21 Agustus backend mengarang isi laporan untuk
  periode yang kosong. Itu sudah dihentikan, jadi di produksi kedua laporan
  sekarang **benar-benar kosong** — dan kosong yang tidak dijelaskan terlihat
  seperti jaringan tanpa masalah, atau lebih buruk, seperti jaringan yang mati.
- **Yang perlu dibedakan:** `belum-ada-data` (tidak ada rekapnya — katakan
  begitu, jangan tampilkan tabel kosong tanpa keterangan), `fixture` (mode
  pengembangan; beri penanda supaya angka bangkitan tidak pernah disangka
  hasil pengukuran), `terukur` (biasa saja).
- **`summary.averageUptime` sekarang bisa `null`.** Saya sudah menambal satu
  baris supaya ia tidak tampil sebagai `%` kosong — itu tambalan sementara di
  wilayahmu, silakan ganti dengan keadaan kosong yang benar. Jangan
  mengembalikannya jadi `0`: "rata-rata uptime 0%" di layar NOC terbaca
  sebagai jaringan yang mati total.
- **Kenapa tidak bisa diakali dari backend:** angka jujurnya sudah ada; yang
  belum ada adalah cara mengatakannya kepada orang yang melihat layar.

### ✅ T-21. Wallboard `/tv` — layar yang digantung di ruang NOC — frontend selesai 2026-08-22

- **Layar:** halaman **baru** `src/app/tv/page.tsx`. Sekarang belum ada sama
  sekali, jadi `/tv` menjawab 404 padahal `src/proxy.ts` sudah membukanya untuk
  publik dan seluruh backendnya sudah hidup di produksi.
- **Butuh:** §15. Satu endpoint saja: `GET /api/v1/tv/snapshot`. Jangan panggil
  yang lain — semuanya 401 di halaman ini.
- **Bentuknya:** satu layar 16:9 penuh, tanpa nav, tanpa sidebar, tanpa scroll.
  Isi yang tersedia: angka uplink masuk/keluar + kurva, hitungan perangkat
  online/warning/offline, peta penanda, gerombolan padam, daftar insiden aktif,
  dan sesi PPPoE + trennya. Susun sesukamu — yang penting terbaca dari 3 meter.
- **Polling:** 10 detik, sama seperti hook dashboard lain. `refreshWhenHidden:
  true` — TV tidak pernah "fokus".
- **Angkanya pakai `formatBitrate`** dari `src/lib/noc-format.ts` (baru,
  21 Agustus). Jangan tulis pemformat sendiri di halaman ini — dinding ruangan
  bukan tempat yang baik untuk menemukan bahwa dua layar menyebut angka yang
  sama dengan dua cara.
- **Delapan jebakannya ada di §15 dan semuanya nyata.** Yang paling mudah
  terlewat: nomor 3 (coba `snapshot` dulu, baru fragmen — supaya layar hidup
  lagi sendiri setelah listrik kedip) dan nomor 4 (401 jangan dialihkan ke
  `/login`).
- **Peta:** `basemaps.cartocdn.com` ikut termuat di layar ini. Itu sebabnya
  token ada di fragmen dan `Referrer-Policy: no-referrer` dipasang — jangan
  ubah salah satunya.
- **Kenapa tidak bisa diakali dari backend:** seluruh datanya sudah ada dalam
  satu muatan. Yang belum ada hanya yang menggambarnya.

### ✅ T-22. Layar kelola token TV (admin) — frontend selesai 2026-08-22

- **Layar:** tambahan di area admin yang sudah ada (`/users` terasa paling
  wajar; kalau menurutmu halaman sendiri lebih baik, silakan).
- **Butuh:** §15 — `GET`/`POST /api/v1/tv/tokens`, `POST
  /api/v1/tv/tokens/:id/revoke`. Semuanya `admin` saja.
- **Bentuknya:** daftar token (nama, `tokenPrefix`, kapan dibuat, kedaluwarsa,
  terakhir dipakai, berapa kali, dicabut atau belum) + tombol terbitkan +
  tombol cabut dengan konfirmasi.
- **Satu hal yang tidak boleh salah:** `token` dan `url` hanya muncul **sekali**
  di jawaban `POST`, dan tidak bisa dibaca lagi dari mana pun. Tampilkan besar,
  sediakan tombol salin, dan katakan terus terang bahwa menutup dialog berarti
  harus menerbitkan token baru. Jangan simpan ke `localStorage` "supaya aman" —
  itu justru memindahkannya ke tempat yang tidak pernah kedaluwarsa.
- **Kenapa tidak bisa diakali dari backend:** token tidak akan pernah ada
  sampai ada layar yang bisa menerbitkannya. Sekarang `tv_tokens` masih kosong,
  jadi T-21 pun belum bisa diuji di luar dev tanpa ini.

### ✅ T-19. Peta membuka di Jakarta, padahal seluruh jaringan di Bali — SELESAI 2026-08-20

Ditemukan 20 Agustus dengan membuka portal di browser dalam keadaan login —
tidak terlihat dari kode HTTP mana pun, dan tidak terlihat dari isi API:
**API-nya benar. T-19 kini selesai di sisi frontend.**

`GET /api/devices/geo` memulangkan ketujuh perangkat dengan koordinat Bali
(115.58–115.67, −8.39…−8.46). Tapi `/dashboard` dan `/map` membuka di
**Jakarta**, kosong tanpa titik.

**Sebabnya bukan `DEFAULT_CENTER`.** `network-map.tsx:19` memang menyimpan
`[-6.21, 106.845]`, tapi komponennya SUDAH punya auto-fit yang benar
(`FitToVisibleDevices`). Yang salah kapan ia berjalan:

```ts
useEffect(() => {
  if (devices.length === 0) return;   // ← saat mount, data belum datang
  …
}, [filterKey, map]);                 // ← devices sengaja tidak masuk deps
```

Saat mount `devices` masih kosong (datanya async), jadi efeknya keluar lebih
awal. Ketika data tiba, efeknya **tidak dijalankan ulang** karena `devices`
sengaja dikeluarkan dari deps — dan alasan itu **benar**: tanpa itu peta
terbang ulang tiap kali data disegarkan 10 detik sekali.

Jadi jangan hapus alasannya, tambahkan pemicunya: fit **sekali** saat data
pertama kali tidak kosong. Mis. masukkan `devices.length > 0` (bukan
`devices`) ke deps, atau buang early-return lalu lewati bila
`hasFitted.current` sudah true.

Bukti auto-fit-nya sendiri benar: begitu filter diubah, peta langsung terbang
ke Bali. Cacatnya murni "tidak pernah terpicu pertama kali".

**Sekalian, kecil:** beberapa placeholder masih dari zaman data fiktif Jakarta
— form ODP di `/ftth` menyarankan `ODP-JKT-001`, `-6.2`, `106.8`, padahal
seluruh 577 ODP ada di sekitar `-8.4, 115.6`. Form situs di `/sites` sama.
Placeholder yang menyesatkan bukan bug, tapi ia mengajari orang memasukkan
angka yang salah.

**Kenapa tidak bisa diperbaiki dari backend:** datanya sudah benar sampai ke
GeoJSON. Yang salah kapan peta memutuskan ke mana ia melihat.

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

- **T-40** — `/ftth` memakai pencarian/filter/sorting/pagination server-side,
  membaca `total`, dan menampilkan `terpotong` bila respons dibatasi.
- **T-39** — Ringkasan ONU menampilkan status fase tak dikenal tanpa
  menghilangkan selisih terhadap total ONU.
- **T-38** — Output konsol memiliki tinggi tetap dengan gulir, metadata ukuran,
  pencarian dan hit count, serta pembukaan awal 50 baris yang menyebut jumlah
  baris tersembunyi.
- **T-37** — Panel daftar ONU di `/console` memakai POST eksplisit, menyajikan
  filter/pagination/ringkasan dari server, mempertahankan `takTerurai`, dan
  membedakan respons 501 dari daftar kosong.
- **T-36** — Grid optik OLT menampilkan sumber dan catatan server, serta tidak
  mengubah `txPower: null` menjadi angka atau menambahkan tanda `+` yang salah.
- **T-35** — Kartu suhu membedakan loading dari perangkat tanpa sensor; keadaan
  tanpa sensor tidak menampilkan angka maupun status suhu.
- **T-34** — Grafik riwayat perangkat dan CPU/RAM live membedakan data terukur,
  fixture, dan belum ada data; nilai `null` tetap menjadi jeda garis dan alasan
  dari server terlihat di layar.
- **T-20** — Kartu trafik dashboard kini membaca live/series traffic dengan
  polling SWR 10 detik, menampilkan angka uplink masuk/keluar dalam bps,
  kurva 24 jam yang memutus titik `null`, status stale/umur data, serta baris
  per situs yang membedakan `belum-ada-data`, `hilang`, dan utilisasi `null`.
- **T-19** — Auto-fit peta kini terpicu sekali saat perangkat pertama kali
  tersedia, tetap mengikuti perubahan filter, dan tidak terbang ulang pada
  refresh polling biasa. Placeholder kode/koordinat form ODP dan situs sudah
  memakai konteks Bali (`BALI`, `-8.400000`, `115.600000`).
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

- **2026-08-22** — **T-40 dan T-39 selesai di frontend.** Daftar ODP di
  `/ftth` kini mencari dan menyaring lewat server dengan pagination, sedangkan
  ringkasan ONU di `/console` tidak lagi menyembunyikan fase perangkat yang
  belum dikenal.
- **2026-08-22** — **T-38 dan T-37 selesai di frontend.** Output konsol kini
  dibatasi secara eksplisit dan dapat dicari tanpa mengubah teks mentahnya;
  panel daftar ONU di `/console` menggunakan POST saat diminta, dengan filter,
  pagination, ringkasan status, peringatan baris yang tak terurai, dan keadaan
  501/429 yang jujur.
- **2026-08-22** — **T-36 dan T-35 selesai di frontend.** Grid optik OLT kini
  menampilkan sumber/catatan, mempertahankan tanda dBm, dan menunjukkan "—"
  untuk `txPower` yang tidak terbaca. Kartu suhu membedakan loading dari
  perangkat yang memang tidak memiliki sensor suhu.
- **2026-08-22** — **T-34 selesai di frontend.** Grafik riwayat perangkat kini
  menampilkan `sumber`, `titikTerukur`, dan `catatan` dari endpoint; nilai
  `null` tidak diubah menjadi nol. Grafik CPU/RAM live menampilkan `—` dan
  tooltip yang jelas saat salah satu sensor tidak terbaca.
- **2026-08-22** — **Grafik riwayat perangkat berhenti mengarang.**
  `/api/devices/:id/metrics-history` selalu mengisi deretnya dengan
  `generateHistorySeries()` — angka deterministik per deviceId, bentuk
  meyakinkan, tidak pernah diukur. Komentarnya sendiri berbunyi "nantinya
  query tabel metric_history", dan tabel itu tidak pernah dibuat. Sementara
  `traffic_samples` sudah berisi 81 ribu cuplikan nyata sejak 20 Agustus.
  Sekarang `bandwidth` dibaca dari sana, jeda pengukuran jadi `null` bukan 0,
  dan metrik yang belum punya sumber mengaku `belum-ada-data`. Satu keputusan
  yang diperketat oleh tesnya sendiri: `terukur` hanya sah kalau ADA yang
  terukur — uplink terdaftar tanpa satu pun cuplikan tetap `belum-ada-data`.
  Tugas T-34.
- **2026-08-22** — **Core-in-tube — frontend selesai.** Form tambah kabel
  mengirim `tubeSize` bila diisi, sedangkan matriks core menampilkan
  `coreNumber`, `tubeNumber`, dan `coreInTube` dari server. Frontend tidak
  menghitung warna atau penomoran sendiri; kabel tanpa tube tetap tampil
  sebagai "Tanpa tube".
- **2026-08-22** — **Fase 16: riwayat topologi (§22).** Fase terakhir modul
  ini, dan tanpa satu pun tabel baru — seluruh riwayat sudah tertulis di
  `audit_logs` sejak Fase 11, di dalam transaksi yang sama dengan mutasinya.
  Yang kurang cuma cara membacanya. Dua hal yang menentukan bentuknya: ruang
  lingkup dikembangkan di server (riwayat OTB membawa tray dan portnya, kalau
  tidak ia cuma berisi satu baris dan terlihat berfungsi padahal tidak
  berguna), dan penanda halaman memakai waktu DAN id — pemasangan silangan
  massal menulis beberapa baris pada milidetik yang sama, dan penanda berbasis
  waktu saja akan melewatkan sebagiannya tanpa ada yang menyadari. Tugas T-33
  mengisi tab "Riwayat" yang sejak Fase 11 sengaja dibiarkan kosong.
- **2026-08-22** — **Fase 15: garis jalur fiber di peta (§21).** Letak kabel
  diturunkan dari tempat core-nya menempel — tidak ada kolom geometri, dan
  tidak akan ada. Aturan yang menentukan seluruh bentuknya: kabel yang
  letaknya tidak diketahui TIDAK digambar, ia masuk `tanpaGeometri` beserta
  alasannya. Garis tebakan di peta jaringan dipakai orang untuk memutuskan ke
  mana berangkat saat kabel putus, dan garis yang salah mengirim teknisi ke
  tempat yang salah dengan keyakinan penuh. Empat bentuk "tidak tahu" diuji
  terpisah: belum tersambung, tersambung sebelah, jangkar tanpa koordinat, dan
  satu ujung yang menempel di dua tempat. Tugas T-32.
- **2026-08-22** — **Riwayat terminasi punya endpoint per-KABEL (§17).**
  Tinjauan kode menemukan layar kabel memanggil endpoint per-core di dalam
  `Promise.all`: kabel 24 core jadi 24 permintaan HTTP, kabel 288 core jadi
  288, masing-masing dengan join lima tabel. Kesalahan rancangan API, bukan
  kesalahan layarnya — endpoint per-kabel memang belum ada. Tugas T-31, bersama
  debounce kotak cari PPPoE yang belum terpasang.
- **2026-08-21** — **`formatPanjang` masuk `noc-format.ts`,** setelah tinjauan
  kode menemukan konversi meter→kilometer tersalin di dua komponen. Aturan
  "jangan bikin pembagi sendiri" sudah saya tulis untuk satuan trafik, tapi
  helper untuk panjang tidak pernah saya sediakan — kelalaian yang sama
  bentuknya dengan `formatBitrate` yang tidak pernah dipakai. Tugas T-30.
- **2026-08-21** — **Sesi PPPoE disaring dan dihalamani DATABASE (§20).**
  Endpointnya dulu mengirim seluruh sesi sekaligus — ~1.600 baris tiap kali
  `/pppoe` dibuka. Bebannya satu soal; yang lebih berbahaya, penyaringan di
  browser hanya menyaring yang TERKIRIM, jadi begitu sesi melewati batas
  pencarian jadi tidak lengkap tanpa ada yang tahu — dan "tidak ada di daftar"
  terlihat sama persis dengan "offline". Sekarang `q`, `router`, `sort`, dan
  halaman 20/50/100 semuanya dikerjakan SQL, dan `total` adalah jumlah setelah
  saringan. Mode tanpa halaman sengaja dipertahankan sampai T-28 mendarat.
  Tugas T-28; satuan trafik dasbor jadi T-29.
- **2026-08-21** — **Riwayat terminasi core punya endpoint (§17).** Diminta
  Luna lewat `PERMINTAAN-FRONTEND-KE-BACKEND.md`, dan temuannya tepat:
  `riwayatTerminasiCore` sudah ada sejak Fase 12 tapi tidak pernah punya
  route, jadi panel riwayat di layar kabel tidak punya sumber data. Label port
  ikut dirakit di server supaya riwayat panjang tidak berubah jadi puluhan
  permintaan.
- **2026-08-21** — **Fase 14: mesin trace (§19).** Jalur dari port OTB sampai
  ODP, lewat closure dan master splitter — TANPA tabel baru; seluruhnya
  diturunkan dari Fase 11–13. Menyimpan jalur sebagai tabel berarti angka
  kedua tentang hal yang sama, dan ia basi pada perubahan topologi pertama.
  Prinsipnya: tidak mengarang. Jalur putus berkata putus di titik mana, bukan
  melompat ke tebakan terdekat — jalur karangan lebih berbahaya daripada tidak
  ada jalur, karena ia dipercaya dan dipakai mengirim teknisi. Arah di
  splitter disimpulkan dari peruntukan core, jadi telusur balik dari ODP tidak
  menyeberang ke ODP tetangga; aturan "satu splitter, satu input feeder"
  ditegakkan saat terminasi. Panjang dijumlahkan per lintasan, bukan per
  segmen unik — kabel yang dilewati bolak-balik memang ditempuh dua kali.
  Tugas T-27.
- **2026-08-21** — **Fase 13: closure dan silangan core (§18).** "Core 17
  menjadi Core 23" akhirnya bisa dicatat sebagai kenyataan. Larangan membagi
  di closure biasa ditegakkan index unik — satu ujung core masuk, satu
  sambungan aktif; percobaan membagi ditolak PostgreSQL, bukan disembunyikan
  dari layar. Pemasangan massal semua-atau-tidak: satu baris bentrok
  membatalkan seluruh batch, karena matriks yang tersimpan separuh terlihat
  sudah dikerjakan. Pratinjau dan commit memakai fungsi pemeriksa yang SAMA,
  dan ada tes yang menuntut verdict-nya identik. Uji mutasi menemukan lubang
  nyata di tes sendiri: penjagaan ujung core punya dua arah, dan hanya satu
  yang diuji. Tugas T-26.
- **2026-08-21** — **Fase 12: kabel, core, dan terminasi (§17).** Lapisan di
  antara OTB dan ODP. Yang berubah sifatnya di sini: okupansi tidak lagi
  dijanjikan kode, ia ditegakkan tiga *partial unique index* — satu ujung core
  dan satu port hanya punya satu terminasi aktif, dan dua operator yang
  menekan simpan bersamaan tidak bisa lagi menghasilkan okupansi ganda. Ada
  tes yang menulis LANGSUNG ke tabel untuk membuktikannya; kalau index-nya
  dihapus, tes itu merah. Melepas terminasi tidak menghapus barisnya —
  index-nya parsial, jadi riwayat tetap utuh tanpa menghalangi port dipakai
  lagi. FK ke port memakai `restrict`, yang membuat aturan kapasitas Fase 11
  tetap benar tanpa satu baris pun diubah di sana. Tugas T-25.
- **2026-08-21** — **Fase 11: OTB, tray, dan port.** PRD OTB/core-route/master
  splitter masuk lewat `.orca/drops/`, dan pemeriksaan menunjukkan ia ditulis
  untuk app lain (Prisma) dengan klaim status yang tidak berdiri: `OTBTray`,
  `MasterSplitter*`, dan `ODPFiberTermination` yang ia tandai "Selesai"
  ternyata tidak ada di repo PerumNet mana pun. Jadi ini bukan melanjutkan
  fase yang tertinggal — ini mulai dari nol. Yang dibangun baru lapisan paling
  bawah: `otb`, `otb_trays`, `otb_ports` (§16, migrasi `0008_otb_tray_port`),
  tugas T-24. **Master Splitter sengaja TIDAK dibuat tabel baru** — ia sudah
  ada sebagai `odps.role='MS'` dengan 63 baris produksi, dan PRD itu sendiri
  melarang membuat master paralel untuk ODP. Nomor port global disimpan, bukan
  dihitung dari kapasitas, supaya label yang sudah tertempel di lapangan tidak
  pernah menunjuk port yang salah.
- **2026-08-21** — **Laporan berhenti mengarang, dan `GET /api/reports/sla`
  berhenti 500 di produksi.** Komentar di kepala `reports.ts` sudah lama
  menjanjikan "produksi/terhubung: seed tidak dijalankan", tapi hanya
  `ensureAssetsSeed` yang benar-benar berhenti — kedua seed rekap tetap
  menulis angka fixture dan membentur foreign key `assets`. Foreign key itulah
  yang menyelamatkan: tanpanya, satu kali membuka halaman laporan sudah cukup
  untuk menanam angka uptime karangan ke database produksi secara permanen,
  dan menyajikannya sebagai hasil pengukuran selamanya. Sekarang dijaga, dan
  laporan kosong mengaku kosong lewat `source`. Tugas T-23.
- **2026-08-21** — `formatBitrate` masuk `src/lib/noc-format.ts`, jadi
  satu-satunya pemformat bitrate di repo ini. Dijanjikan di §14 nomor 1 sejak
  20 Agustus tapi belum pernah ada, jadi T-20 terpaksa menampilkan bps mentah.
  Pembaginya 1000 (desimal), bukan 1024 — ada tesnya, karena selisih 7% dari
  LibreNMS adalah jenis salah yang paling lama tidak ketahuan.
- **2026-08-21** — **Mode TV punya kontraknya** (§15) + tugas T-21 dan T-22.
  Backendnya sudah hidup di produksi sejak 20 Agustus, tapi tidak ada layar,
  tidak ada kontrak, dan `tv_tokens` masih kosong — fitur yang jadi tapi tidak
  bisa dipakai siapa pun.
- **2026-08-21** — **Username pelanggan bocor ke muatan layar TV.** `outages`
  memakai `ReturnType<typeof ringkasPadam>` apa adanya, jadi
  `Gerombol.usernames` — daftar username PPPoE — ikut ke layar yang berdiri di
  ruangan terbuka, dan ke siapa pun yang tautannya bocor. Ditutup lewat
  `rapikanPadam` di `src/server/tv-sanitize.ts`. Tes penjaganya sebelumnya
  hanya menyisir contoh buatan tangan dan tidak pernah menyentuh muatan yang
  sebenarnya — persis jenis penjaga yang tidak bisa dibedakan dari penjaga yang
  rusak; sekarang ia menjalankan pemangkas yang asli terhadap masukan yang
  kotor.
- **2026-08-21** — Cookie TV kini diperbarui tiap snapshot yang sah. Sebelumnya
  layar mati sendiri pada jam ke-12: tokennya sudah dihapus dari address bar
  demi keamanan, dan wallboard tidak punya keyboard untuk memasukkannya lagi.
  Pencabutan tetap seketika — keduanya diuji di berkas yang sama supaya yang
  melonggarkan satu sisi melihat sisi lainnya.
- **2026-08-21** — Dua `void promise` tanpa `.catch` ditambal
  (`tv/snapshot`, webhook `librenms/alerts`). Di Node 22 unhandled rejection
  mengakhiri proses: satu alert dari LibreNMS saat CRM sedang tumbang cukup
  untuk menjatuhkan portal NOC, persis pada menit ketika ia paling dibutuhkan.
- **2026-08-20** — **Trafik nyata masuk portal** (§14). Worker mengambil dari
  MikroTik tiap 30 detik; endpoint membaca dari database dan TIDAK pernah
  menghubungi router. Uplink terbaca ±3 Gbps masuk / 315 Mbps keluar, cocok
  sekelas dengan angka LibreNMS. Tugas T-20.
- **2026-08-20** — T-19: peta membuka di Jakarta padahal API-nya sudah benar;
  auto-fit tidak pernah terpicu saat pemuatan pertama. Ditemukan dengan
  membuka portal di browser dalam keadaan login.
- **2026-08-20** — Koordinat ketujuh aset diisi dari situsnya; sebelumnya
  kosong semua, jadi peta tidak punya apa pun untuk digambar.
- **2026-08-20** — ⚠️ Commit `66ec492` berpesan "T-19" padahal isinya catatan
  T-18 selesai milik Luna. Salah label dari Opus, bukan salah isi; riwayat
  yang sudah ter-merge tidak ditulis ulang.

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
