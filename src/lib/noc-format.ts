export function formatDateTime(value: string | null | undefined, fallback = "—") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateOnly(value: string | null | undefined, fallback = "—") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatAge(value: string | null | undefined, fallback = "Belum ada data") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "baru saja";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.floor(hours / 24)} hari lalu`;
}

export function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days > 0) return `${days}h ${hours}j`;
  if (hours > 0) return `${hours}j ${minutes}m`;
  return `${minutes}m`;
}

export function formatNumber(value: number | null | undefined) {
  return value === null || value === undefined
    ? "—"
    : new Intl.NumberFormat("id-ID").format(value);
}

export function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Laju dalam bit per detik → "3,03 Gbps".
 *
 * **Pembaginya 1000, bukan 1024, dan itu bukan kelalaian.** Laju jaringan
 * memakai awalan desimal — 1 Gbps berarti 1.000.000.000 bit per detik, begitu
 * pula yang dilaporkan MikroTik dan LibreNMS. Memakai 1024 di sini akan
 * membuat angka portal meleset ~7% dari angka yang sama di LibreNMS, dan
 * selisih sekecil itu justru yang paling lama membingungkan: terlalu kecil
 * untuk terlihat salah, terlalu besar untuk diabaikan. Bandingkan
 * `formatBytes` di atas, yang memang memakai 1024 karena ukuran berkas.
 *
 * Satu-satunya pemformat bitrate di repo ini — dipakai kartu trafik dasbor
 * (T-20) dan wallboard TV (T-21). Dua definisi "Mbps" yang pembulatannya
 * berbeda akan menghasilkan dua angka untuk hal yang sama.
 *
 * `null` tetap "—", tidak pernah "0 bps": laju yang belum ada bukan laju nol.
 */
export function formatBitrate(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  if (!Number.isFinite(value)) return "—";
  const negatif = value < 0;
  const v = Math.abs(value);
  const satuan =
    v < 1_000 ? ["bps", 1] :
    v < 1_000_000 ? ["kbps", 1_000] :
    v < 1_000_000_000 ? ["Mbps", 1_000_000] :
    v < 1_000_000_000_000 ? ["Gbps", 1_000_000_000] :
    ["Tbps", 1_000_000_000_000];
  const [nama, pembagi] = satuan as [string, number];
  const angka = v / pembagi;
  const teks = new Intl.NumberFormat("id-ID", {
    // Di bawah 10 dua desimal masih berarti (3,03 Gbps); di atasnya tidak.
    maximumFractionDigits: pembagi === 1 ? 0 : angka < 10 ? 2 : 1,
  }).format(angka);
  return `${negatif ? "-" : ""}${teks} ${nama}`;
}

/**
 * Panjang kabel dalam meter → teks yang bisa dibaca.
 *
 * Satu sumber untuk seluruh layar. Saat ditulis, konversi meter→kilometer
 * sudah tersalin di dua komponen (`fiber-page.tsx` dan `trace-panel.tsx`) —
 * dan dua salinan rumus yang sama selalu berakhir berbeda begitu ada yang
 * memperbaiki pembulatan di satu tempat saja.
 *
 * `null` berarti **belum diukur**, dan itu bukan nol. Ia tidak pernah
 * dijumlahkan sebagai nol di server, jadi ia tidak boleh tampil sebagai
 * "0 m" di layar.
 *
 * `lengkap: false` menandai total yang masih kekurangan segmen — ditampilkan
 * dengan awalan `≥`, supaya angkanya tidak terbaca sebagai jarak pasti.
 */
export function formatPanjang(
  meter: number | null | undefined,
  lengkap = true,
) {
  if (meter === null || meter === undefined) return "Belum diukur";
  if (!Number.isFinite(meter)) return "—";
  const negatif = meter < 0;
  const v = Math.abs(meter);
  const teks =
    v >= 1_000
      ? `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(v / 1_000)} km`
      : `${new Intl.NumberFormat("id-ID").format(v)} m`;
  const bertanda = `${negatif ? "-" : ""}${teks}`;
  return lengkap ? bertanda : `≥ ${bertanda}`;
}
