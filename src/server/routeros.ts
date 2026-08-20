// Klien RouterOS REST bersama.
//
// Diangkat dari `src/server/pppoe.ts` saat pengambil trafik lahir (20 Agustus
// 2026). Alasannya bukan kerapian: logika pelonggaran TLS tidak boleh punya
// dua salinan. Kalau kelak router dipasangi sertifikat yang benar dan salah
// satu salinan dikencangkan, salinan kedua akan tetap longgar tanpa ada yang
// tahu — dan itu jenis perbedaan yang tidak terlihat sampai terlambat.
//
// `pppoe.ts` meng-import lalu meng-export ulang nama-nama ini, jadi permukaan
// publiknya tidak berubah.

import https from "node:https";

export interface RouterConfig {
  baseUrl: string;
  user: string;
  password: string;
  routerName: string;
}

/**
 * Melengkapi alamat router yang ditulis tanpa skema.
 *
 * Menerima `192.168.100.1` maupun `https://192.168.100.1` — orang wajar
 * mengetik alamatnya saja, dan menolaknya karena kurang `https://` adalah
 * kekakuan yang tidak membeli apa pun. Terjadi 19 Agustus 2026: alamat
 * ditulis tanpa skema, `new URL()` melempar "Invalid URL", dan tugasnya gagal
 * dengan pesan yang tidak menyebut alamat sama sekali.
 *
 * Bawaannya `https` — RouterOS REST memang di sana, dan menebak `http`
 * berarti kredensial melintas polos di jaringan.
 */
export function normalkanUrlRouter(raw: string | undefined | null): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const lengkap = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(lengkap);
    if (!u.hostname) return null;
    return lengkap.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function routerConfig(): RouterConfig | null {
  const baseUrl = normalkanUrlRouter(process.env.MIKROTIK_URL);
  const user = process.env.MIKROTIK_USER?.trim();
  const password = process.env.MIKROTIK_PASSWORD?.trim();
  if (!baseUrl || !user || !password) return null;
  return {
    baseUrl,
    user,
    password,
    routerName: process.env.MIKROTIK_NAME?.trim() || new URL(baseUrl).hostname,
  };
}

/**
 * Sebab konfigurasi belum bisa dipakai — supaya SKIPPED menyebut yang benar,
 * bukan selalu "belum diisi" padahal sudah diisi tapi bentuknya salah.
 */
export function sebabBelumSiap(): string | null {
  const kosong = (["MIKROTIK_URL", "MIKROTIK_USER", "MIKROTIK_PASSWORD"] as const)
    .filter((n) => !process.env[n]?.trim());
  if (kosong.length) return `${kosong.join(", ")} belum diisi`;
  if (!normalkanUrlRouter(process.env.MIKROTIK_URL)) {
    return `MIKROTIK_URL="${process.env.MIKROTIK_URL}" bukan alamat yang sah`;
  }
  return null;
}

/**
 * TLS longgar HANYA bila diminta secara eksplisit.
 *
 * Router memakai sertifikat yang ia terbitkan sendiri. Yang membuat ini bisa
 * diterima: jaringannya internal, dan yang dikirim cuma permintaan BACA.
 */
export function tlsLonggar(): boolean {
  return (process.env.MIKROTIK_INSECURE_TLS ?? "").trim().toLowerCase() === "true";
}

export const TIMEOUT_BAWAAN_MS = 15_000;

/**
 * Dipakai langsung, bukan lewat `fetch`: `fetch` Node tidak menyediakan cara
 * melonggarkan verifikasi sertifikat per-permintaan tanpa menambah dependensi
 * atau mematikannya untuk SELURUH proses.
 */
export function ambilJson(
  url: string,
  headers: Record<string, string>,
  opts?: { timeoutMs?: number },
): Promise<unknown> {
  const timeoutMs = opts?.timeoutMs ?? TIMEOUT_BAWAAN_MS;
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: "GET",
        headers,
        timeout: timeoutMs,
        rejectUnauthorized: !tlsLonggar(),
      },
      (res) => {
        let isi = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (isi += c));
        res.on("end", () => {
          if ((res.statusCode ?? 0) === 401) {
            return reject(new Error("RouterOS menolak kredensial (HTTP 401)."));
          }
          if ((res.statusCode ?? 0) >= 400) {
            return reject(new Error(`RouterOS menjawab HTTP ${res.statusCode}`));
          }
          try {
            resolve(JSON.parse(isi));
          } catch {
            reject(new Error("Jawaban RouterOS bukan JSON yang sah."));
          }
        });
      },
    );
    req.on("timeout", () =>
      req.destroy(new Error(`RouterOS tidak menjawab dalam ${timeoutMs / 1000} detik.`)),
    );
    req.on("error", (e) => {
      const pesan = /self.signed|unable to verify|DEPTH_ZERO/i.test(e.message)
        ? `Sertifikat router tidak tepercaya. Setel MIKROTIK_INSECURE_TLS=true bila ini memang router internal kita. (${e.message})`
        : e.message;
      reject(new Error(pesan));
    });
    req.end();
  });
}

/** Header Basic auth untuk RouterOS REST. */
export function headerAuth(cfg: RouterConfig): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${cfg.user}:${cfg.password}`).toString("base64")}`,
    Accept: "application/json",
  };
}
