import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mengizinkan pengujian dari iPhone/perangkat lain pada jaringan lokal.
  // Tanpa ini, Next dev mengirim UI tetapi memblokir JavaScript klien dari IP LAN.
  allowedDevOrigins: ["10.10.2.235", "172.20.10.5"],
  // Toolbar Next.js hanya untuk development dan menutupi kontrol aplikasi pada mobile.
  devIndicators: false,
  /**
   * Header khusus layar TV.
   *
   * `Referrer-Policy: no-referrer` yang paling penting, dan bukan formalitas:
   * peta di layar itu memuat tile dari `basemaps.cartocdn.com` — host pihak
   * ketiga. Tanpa header ini, setiap permintaan tile membawa header `Referer`
   * berisi URL halaman TV ke server orang lain. Wallboard tidak butuh
   * referrer sama sekali, jadi biayanya nol.
   *
   * Tokennya sendiri ditempel di FRAGMEN (`/tv#token=…`) yang memang tidak
   * pernah dikirim ke server mana pun — ini lapis kedua, bukan satu-satunya.
   */
  async headers() {
    const tv = [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
      { key: "Cache-Control", value: "no-store" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    ];
    return [
      { source: "/tv", headers: tv },
      { source: "/tv/:path*", headers: tv },
      { source: "/api/v1/tv/:path*", headers: tv },
    ];
  },
};

export default nextConfig;
