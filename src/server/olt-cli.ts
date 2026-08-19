// Sambungan CLI ke OLT — BACA-SAJA, dan itu dipaksakan, bukan dijanjikan.
//
// Sebagian OLT tidak mendukung SNMP sama sekali (HSGQ-100-Kecicang di
// 192.168.100.10 salah satunya), jadi satu-satunya cara membacanya adalah
// masuk ke konsolnya. Masuk ke konsol berarti memegang kemampuan mengubah
// perangkat produksi — dan itulah yang harus ditutup di sini.
//
// ATURANNYA: portal ini TIDAK PERNAH mengubah, membuat, atau menghapus apa pun
// di perangkat. Login CLI tidak mengubah aturan itu; ia hanya membuat
// pelanggarannya jadi mungkin, dan karena itu penjagaannya justru harus lebih
// keras di sini daripada di tempat lain.
//
// Ini bukan disiplin, melainkan PENOLAKAN. Disiplin gagal pada hari seseorang
// menyalin sebaris kode lalu mengganti perintahnya. Daftar putih menolak
// perintah yang tidak dikenal SEBELUM ia menyentuh soket, dan tidak ada jalan
// mengirim perintah yang melewatinya — `kirimPerintah` satu-satunya pintu, dan
// ia memanggil `periksaPerintahBaca` sebagai baris pertamanya.
//
// Polanya disalin dari `crm/src/lib/olt-telnet.ts` yang sudah terbukti dipakai
// terhadap perangkat yang sama.

import net from "node:net";

export class OltCliError extends Error {}
export class PerintahDitolak extends OltCliError {}

/**
 * Kata pertama yang boleh dikirim ke konsol perangkat.
 *
 * Sengaja sempit: berpindah konteks, melihat, dan bertanya. Satu pun perintah
 * yang mengubah keadaan tidak ada di sini.
 *
 * `configure` dan `interface` ikut diizinkan dengan sadar: pada HSGQ, perintah
 * baca optik hidup DI DALAM konteks `interface gpon N`, dan masuk ke konteks
 * itu tidak mengubah apa pun. Yang mengubah adalah perintah yang dikirim di
 * dalamnya — dan itu tetap disaring daftar yang sama.
 *
 * Menambah anggota ke daftar ini harus jadi keputusan sadar yang terlihat di
 * riwayat berkas ini, dan `tests/olt-cli-baca-saja.test.ts` akan menolak
 * anggota yang mengubah keadaan.
 */
export const PERINTAH_BOLEH = new Set([
  "show", "display", "enable", "configure", "interface", "exit", "quit", "end", "?",
]);

/**
 * Kata kerja yang TIDAK BOLEH ada di daftar putih, apa pun alasannya.
 *
 * Ditulis eksplisit supaya penambahan yang keliru gagal di tes, bukan di
 * perangkat produksi pukul dua pagi.
 */
export const PERINTAH_TERLARANG = [
  "no", "set", "save", "write", "copy", "delete", "remove", "erase", "clear",
  "reboot", "reload", "shutdown", "restart", "add", "create", "modify", "edit",
  "commit", "apply", "ont", "onu", "service-port", "vlan", "password", "user",
];

/**
 * Memastikan sebuah perintah hanya membaca.
 *
 * Yang diperiksa KATA PERTAMANYA — bukan pencocokan pola di tengah kalimat,
 * yang bisa diakali dengan menyisipkan "show" di belakang perintah yang
 * mengubah.
 */
export function periksaPerintahBaca(perintah: string): void {
  const bersih = perintah.trim();
  if (!bersih) return;

  // Pemisah memungkinkan dua perintah menumpang satu baris — "show version;
  // reboot" akan lolos pemeriksaan kata pertama kalau ini tidak ditolak.
  if (/[;\n\r|&]/.test(bersih)) {
    throw new PerintahDitolak(
      `Perintah "${bersih}" memuat pemisah — hanya satu perintah per baris.`,
    );
  }

  const kata = bersih.split(/\s+/)[0].toLowerCase();
  if (!PERINTAH_BOLEH.has(kata)) {
    throw new PerintahDitolak(
      `Perintah "${kata}" ditolak: sambungan ke OLT bersifat BACA-SAJA. ` +
        `Yang diizinkan: ${[...PERINTAH_BOLEH].join(", ")}.`,
    );
  }
}

/**
 * Kredensial dibaca dari env var yang NAMANYA disimpan di database
 * (`olt_devices.credential_ref`), bukan nilainya. Repo ini publik, dan
 * database portal pun bukan tempat menyimpan kata sandi perangkat.
 *
 * Bentuk isinya: `user:password`.
 */
export function bacaKredensial(credentialRef: string | null | undefined): {
  user: string;
  password: string;
} {
  const nama = (credentialRef ?? "").trim();
  if (!nama) {
    throw new OltCliError("OLT ini belum menunjuk nama env var kredensialnya.");
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(nama)) {
    throw new OltCliError(
      `"${nama}" bukan nama env var yang sah — kolom ini menyimpan NAMA, bukan kata sandi.`,
    );
  }
  const isi = process.env[nama];
  if (!isi) throw new OltCliError(`Env var ${nama} belum di-set di proses ini.`);
  const pisah = isi.indexOf(":");
  if (pisah < 1) throw new OltCliError(`Isi ${nama} harus berbentuk "user:password".`);
  return { user: isi.slice(0, pisah), password: isi.slice(pisah + 1) };
}

export interface SesiOpsi {
  host: string;
  port: number;
  credentialRef: string | null;
  timeoutMs?: number;
}

export type Pengirim = (baris: string) => void;

/**
 * Satu-satunya pintu keluar perintah. Memeriksa lebih dulu, baru menulis.
 *
 * Dipisah sebagai fungsi supaya bisa diuji tanpa soket, dan supaya penjaga
 * sumber bisa memastikan tidak ada `socket.write` perintah di tempat lain.
 */
export function kirimPerintah(kirim: Pengirim, perintah: string): void {
  periksaPerintahBaca(perintah);
  kirim(`${perintah}\r\n`);
}

/**
 * Jalankan sederet perintah BACA pada satu sesi telnet, kembalikan keluarannya.
 *
 * Seluruh perintah diperiksa DI MUKA — kalau satu saja ditolak, tidak ada
 * koneksi yang dibuka sama sekali. Perangkat produksi tidak perlu tahu bahwa
 * kita sempat salah.
 */
export async function jalankanPerintahBaca(
  opsi: SesiOpsi,
  perintah: string[],
): Promise<string> {
  for (const p of perintah) periksaPerintahBaca(p);

  const { user, password } = bacaKredensial(opsi.credentialRef);
  const timeoutMs = opsi.timeoutMs ?? 20_000;

  return new Promise<string>((resolve, reject) => {
    const sock = new net.Socket();
    let keluaran = "";
    let tahap: "user" | "password" | "perintah" = "user";
    let indeks = 0;
    let selesai = false;

    const tutup = (err?: Error) => {
      if (selesai) return;
      selesai = true;
      sock.destroy();
      err ? reject(err) : resolve(keluaran);
    };

    sock.setTimeout(timeoutMs);
    sock.once("timeout", () => tutup(new OltCliError(`Tidak ada jawaban dalam ${timeoutMs}ms.`)));
    sock.once("error", (e) => tutup(new OltCliError(e.message)));
    sock.once("close", () => tutup());

    sock.on("data", (buf) => {
      const teks = buf.toString("binary");
      keluaran += teks;

      if (tahap === "user" && /(login|username)\s*:/i.test(teks)) {
        tahap = "password";
        sock.write(`${user}\r\n`);
        return;
      }
      if (tahap === "password" && /password\s*:/i.test(teks)) {
        tahap = "perintah";
        sock.write(`${password}\r\n`);
        return;
      }
      if (tahap === "perintah" && /[>#]\s*$/.test(teks)) {
        if (indeks < perintah.length) {
          kirimPerintah((b) => sock.write(b), perintah[indeks]);
          indeks += 1;
        } else {
          // `exit` ada di daftar putih dan memang harus dikirim — meninggalkan
          // sesi menggantung membuat OLT kehabisan slot login.
          kirimPerintah((b) => sock.write(b), "exit");
          tutup();
        }
      }
    });

    sock.connect(opsi.port, opsi.host);
  });
}
