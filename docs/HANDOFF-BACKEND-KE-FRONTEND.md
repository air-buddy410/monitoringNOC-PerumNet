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
- **Satu pintu (2026-08-17):** login memakai **password email mailcow**, sama
  seperti CRM. Yang menentukan bagaimana password diperiksa adalah server
  (`AUTH_PROVIDER`), bukan frontend — kirim saja `{ email, password }` ke
  `/api/auth/sign-in/portal` dan tangani jawabannya. Tidak ada yang perlu
  dibaca atau ditebak dari sisi klien tentang mode yang sedang aktif.
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
  | `PATCH /api/profile/email` | login | body `{ email }` → `{ user: { id, name, email } }` |
  | **`GET /api/auth-mode`** | publik | `{ provider, passwordChangeAvailable, passwordRequiredOnCreate }` — sumber kebenaran untuk merender form |
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

### T-7. Penanda "mode baca-saja" di shell

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

### T-8. Terapkan design system PerumNet

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
