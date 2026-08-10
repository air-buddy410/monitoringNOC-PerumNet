import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mengizinkan pengujian dari iPhone/perangkat lain pada jaringan lokal.
  // Tanpa ini, Next dev mengirim UI tetapi memblokir JavaScript klien dari IP LAN.
  allowedDevOrigins: ["10.10.2.235", "172.20.10.5"],
  // Toolbar Next.js hanya untuk development dan menutupi kontrol aplikasi pada mobile.
  devIndicators: false,
};

export default nextConfig;
