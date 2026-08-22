// Endpoint daftar ONU — pagarnya, penyaringnya, dan kejujurannya.
//
// Endpoint ini membuka sesi telnet ke perangkat produksi. Yang dijaga:
//   1. Batas lajunya SATU ANGGARAN dengan konsol, bukan anggaran kedua.
//   2. Vendor tanpa perintah daftar ONU menjawab 501 + alasan, BUKAN daftar
//      kosong yang terbaca sebagai "tidak ada ONU".
//   3. Ringkasan dihitung dari seluruh ONU, bukan dari halaman yang tampil.
//   4. Baris yang gagal diurai ikut dikirim, tidak dibuang diam-diam.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  keluaran: "",
  gagal: null as string | null,
  dijalankan: [] as string[],
}));

vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/server/rbac", () => ({
  withRole:
    (_roles: string[], handler: (r: Request, u: unknown, c: unknown) => Promise<Response>) =>
    (request: Request, context: unknown) =>
      handler(request, { id: "u1", name: "Penguji", email: "uji@contoh.id", role: "noc" }, context),
}));
vi.mock("@/server/olt-cli", async (asli) => ({
  ...(await asli<typeof import("@/server/olt-cli")>()),
  jalankanPerintahBaca: async (_o: unknown, perintah: string[]) => {
    mocks.dijalankan.push(...perintah);
    if (mocks.gagal) throw new Error(mocks.gagal);
    return mocks.keluaran;
  },
}));

import * as authSchema from "@/db/auth-schema";
import * as schema from "@/db/schema";
import { POST } from "@/app/api/v1/devices/onu/route";
import { resetPembatas, terlaluSering } from "@/server/konsol-olt";

const DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const sqlAll = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => readFileSync(path.join(DIR, f), "utf8")).join("\n");

const HAPUS = "\x08 \x08".repeat(8);
const KELUARAN = `
ZXAN#
OnuIndex   Admin State  OMCC State  Phase State  Channel
--------------------------------------------------------------
1/2/1:1     enable       enable      working      1(GPON)
1/2/1:2     enable       enable      working      1(GPON)
${HAPUS}1/2/3:6     enable       enable      working      1(GPON)
1/2/3:7     enable       disable     LOS          1(GPON)
1/2/4:9     enable       enable      DyingGasp    1(GPON)
`;

let client: PGlite;
function d() { return mocks.db as ReturnType<typeof drizzle>; }

async function panggil(body: unknown) {
  const res = await POST(
    new Request("http://uji/api/v1/devices/onu", { method: "POST", body: JSON.stringify(body) }),
    undefined,
  );
  return { status: res.status, json: await res.json() };
}

beforeEach(async () => {
  client = new PGlite();
  await client.exec(sqlAll);
  mocks.db = drizzle(client, { schema });
  mocks.keluaran = KELUARAN;
  mocks.gagal = null;
  mocks.dijalankan = [];
  resetPembatas();
  // `audit_logs.actor_user_id` punya FK ke tabel `user` — tanpa baris ini
  // setiap pencatatan audit gagal dan galatnya menyamar jadi galat rute.
  await d().insert(authSchema.user).values({
    id: "u1", name: "Penguji", email: "uji@contoh.id",
    emailVerified: true, createdAt: new Date(), updatedAt: new Date(),
  });
  await d().insert(schema.oltDevices).values([
    { id: "zte", name: "ZTE-C300-102-Pesagi", managementIp: "192.168.100.30", telnetPort: 23, vendor: "ZTE", credentialRef: "UJI" },
    { id: "hsgq", name: "HSGQ-100-Kecicang", managementIp: "192.168.100.10", telnetPort: 1023, vendor: "HSGQ", credentialRef: "UJI" },
    { id: "tanpa-telnet", name: "Tanpa Telnet", managementIp: "192.168.100.99", vendor: "ZTE", credentialRef: "UJI" },
  ]);
});

afterEach(async () => { await client.close(); });

describe("POST /api/v1/devices/onu", () => {
  it("menjalankan perintah ZTE dan mengembalikan baris terurai", async () => {
    const { status, json } = await panggil({ oltId: "zte" });
    expect(status).toBe(200);
    expect(mocks.dijalankan).toEqual(["show gpon onu state"]);
    expect(json.total).toBe(5);
    expect(json.baris.map((b: { indeks: string }) => b.indeks)).toContain("1/2/3:6");
  });

  it("vendor tanpa perintah daftar ONU menjawab 501 + alasan, bukan daftar kosong", async () => {
    // Daftar kosong akan terbaca sebagai "OLT ini tidak punya ONU", yang
    // keliru — HSGQ-100-Kecicang jelas melayani pelanggan.
    const { status, json } = await panggil({ oltId: "hsgq" });
    expect(status).toBe(501);
    expect(json.alasan).toMatch(/HSGQ-G008/);
    // Dan tidak ada sesi telnet yang dibuka sama sekali.
    expect(mocks.dijalankan).toEqual([]);
  });

  it("ringkasan dihitung dari SELURUH ONU, bukan dari halaman yang tampil", async () => {
    const { json } = await panggil({ oltId: "zte", ukuran: 20, halaman: 1, status: "tidak-sehat" });
    // Halaman ini hanya memuat 2 baris tidak sehat…
    expect(json.baris).toHaveLength(2);
    expect(json.totalTersaring).toBe(2);
    // …tapi ringkasannya tetap menyebut seluruhnya.
    expect(json.ringkas).toEqual({ working: 3, LOS: 1, DyingGasp: 1 });
    expect(json.total).toBe(5);
  });

  it("menyaring per phase state dan per pencarian port", async () => {
    const los = await panggil({ oltId: "zte", status: "LOS" });
    expect(los.json.baris).toHaveLength(1);
    expect(los.json.baris[0].indeks).toBe("1/2/3:7");
    const port = await panggil({ oltId: "zte", q: "1/2/1" });
    expect(port.json.baris).toHaveLength(2);
  });

  it("halaman di luar jangkauan dijepit, bukan mengembalikan kosong", async () => {
    const { json } = await panggil({ oltId: "zte", ukuran: 20, halaman: 99 });
    expect(json.halaman).toBe(1);
    expect(json.baris).toHaveLength(5);
  });

  it("ukuran halaman di luar daftar jatuh ke bawaan", async () => {
    const { json } = await panggil({ oltId: "zte", ukuran: 9999 });
    expect(json.ukuran).toBe(50);
  });

  it("baris yang gagal diurai IKUT dikirim", async () => {
    mocks.keluaran = "1/2/1:1 enable enable working 1(GPON)\n1/2/1:2 enable\n";
    const { json } = await panggil({ oltId: "zte" });
    expect(json.takTerurai).toEqual(["1/2/1:2 enable"]);
  });

  it("OLT tanpa telnet_port menjawab 409, tanpa membuka apa pun", async () => {
    const { status } = await panggil({ oltId: "tanpa-telnet" });
    expect(status).toBe(409);
    expect(mocks.dijalankan).toEqual([]);
  });

  it("OLT tak dikenal menjawab 404", async () => {
    expect((await panggil({ oltId: "entah" })).status).toBe(404);
  });

  it("oltId kosong menjawab 400", async () => {
    expect((await panggil({})).status).toBe(400);
  });

  it("kegagalan telnet menjawab 502, bukan 200 berisi kosong", async () => {
    mocks.gagal = "Tidak ada jawaban dalam 30000ms.";
    const { status, json } = await panggil({ oltId: "zte" });
    expect(status).toBe(502);
    expect(json.error).toMatch(/Tidak ada jawaban/);
  });

  it("batas laju SATU ANGGARAN dengan konsol, bukan anggaran kedua", async () => {
    // Kalau tiap endpoint punya pembatasnya sendiri, satu pengguna bisa
    // membuka 20 sesi lewat konsol DAN 20 lagi lewat sini dalam menit yang
    // sama — dua kali lipat batas yang sengaja dipasang.
    for (let i = 0; i < 20; i += 1) expect(terlaluSering("u1")).toBe(false);
    const { status } = await panggil({ oltId: "zte" });
    expect(status).toBe(429);
  });
});
