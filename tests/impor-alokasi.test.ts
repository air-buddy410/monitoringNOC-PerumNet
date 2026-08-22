// Penguraia sheet "Alokasi Core 144".
//
// Contoh di berkas ini DISALIN dari sheet produksi 14 Agustus 2026, termasuk
// kekeliruannya. JANGAN "dirapikan": label yang keliru itulah yang harus
// terdeteksi, dan sheet yang sudah dibetulkan tidak menguji apa pun.

import { describe, expect, it } from "vitest";
import { WARNA_CORE } from "@/db/schema";
import {
  SERAT_PER_TABUNG,
  WARNA_TABUNG,
  catatanCore,
  uraiAlokasiCore,
} from "@/server/impor-alokasi";

const KEPALA = "fo_id,label,warna_tube,dari,next_hop,usage,service";

/** Sheet utuh 144 serat, dengan kekeliruan label yang sama persis. */
function sheetPenuh(): string {
  const baris = [KEPALA];
  for (let fo = 1; fo <= 144; fo += 1) {
    const t = Math.floor((fo - 1) / 12) + 1;
    const c = ((fo - 1) % 12) + 1;
    // Kekeliruan nyata: tiap tabung 5–12, baris CORE 4-nya tertulis
    // "CORE <nomor tabung>" — khas kesalahan tarik-isi spreadsheet.
    const cSheet = c === 4 && t >= 5 ? t : c;
    baris.push(`${fo},TUBE ${t} - CORE ${cSheet},WARNA / G. 652,To RK Jalur 11,To Belong,,`);
  }
  return baris.join("\n");
}

describe("uraiAlokasiCore", () => {
  it("menurunkan tabung, posisi, dan warna dari FO ID", () => {
    const h = uraiAlokasiCore(
      `${KEPALA}\n1,TUBE 1 - CORE 1,BLUE / G. 652,To RK Jalur 11,To Belong,Uplink TBG,Metro E Via TBG`,
      1,
    );
    const b = h.baris[0];
    expect(b.foId).toBe(1);
    expect(b.tubeNumber).toBe(1);
    expect(b.coreInTube).toBe(1);
    expect(b.color).toBe("biru");
    expect(b.usage).toBe("Uplink TBG");
    expect(b.service).toBe("Metro E Via TBG");
  });

  it("serat ke-13 masuk tabung 2, posisi 1 — bukan tabung 1 posisi 13", () => {
    const h = uraiAlokasiCore(`${KEPALA}\n13,TUBE 2 - CORE 1,ORANGE,,,,`, 13);
    const b = h.baris.find((x) => x.foId === 13)!;
    expect(b.tubeNumber).toBe(2);
    expect(b.coreInTube).toBe(1);
    // Warna mengikuti posisi DI DALAM tabung, bukan nomor se-kabel.
    expect(b.color).toBe("biru");
  });

  it("melaporkan kedelapan label keliru — tanpa membetulkannya", () => {
    const h = uraiAlokasiCore(sheetPenuh(), 144);
    const keliru = h.masalah.filter((m) => m.jenis === "label-keliru");
    expect(keliru.map((m) => m.foId)).toEqual([52, 64, 76, 88, 100, 112, 124, 136]);

    // Posisinya tetap diturunkan dari FO ID — yang benar.
    const fo52 = h.baris.find((b) => b.foId === 52)!;
    expect(fo52.tubeNumber).toBe(5);
    expect(fo52.coreInTube).toBe(4);
    // Tapi label sheetnya disimpan APA ADANYA, tidak ditulis ulang.
    expect(fo52.label).toBe("TUBE 5 - CORE 5");
  });

  it("seluruh 144 serat tetap terbaca walau delapan labelnya keliru", () => {
    const h = uraiAlokasiCore(sheetPenuh(), 144);
    expect(h.baris).toHaveLength(144);
    expect(h.masalah.filter((m) => m.jenis === "fo-id-hilang")).toHaveLength(0);
    expect(h.masalah.filter((m) => m.jenis === "fo-id-ganda")).toHaveLength(0);
  });

  it("FO ID yang hilang dilaporkan, tidak diam-diam dilewati", () => {
    // Sheet yang kehilangan satu baris menghasilkan kabel yang terlihat utuh
    // dengan satu serat yang tidak pernah ada.
    const h = uraiAlokasiCore(`${KEPALA}\n1,TUBE 1 - CORE 1,BLUE,,,,\n3,TUBE 1 - CORE 3,BLUE,,,,`, 3);
    expect(h.masalah.filter((m) => m.jenis === "fo-id-hilang").map((m) => m.foId)).toEqual([2]);
  });

  it("FO ID ganda dilaporkan dan tidak digandakan jadi dua serat", () => {
    const h = uraiAlokasiCore(`${KEPALA}\n1,TUBE 1 - CORE 1,BLUE,,,,\n1,TUBE 1 - CORE 1,BLUE,,,,`, 1);
    expect(h.masalah.filter((m) => m.jenis === "fo-id-ganda")).toHaveLength(1);
    expect(h.baris).toHaveLength(1);
  });

  it("baris tanpa FO ID yang sah dilaporkan, bukan jadi serat nomor NaN", () => {
    const h = uraiAlokasiCore(`${KEPALA}\n,TUBE 1 - CORE 1,BLUE,,,,\nx,TUBE 1 - CORE 2,BLUE,,,,`, 0);
    expect(h.masalah.filter((m) => m.jenis === "baris-tak-terbaca")).toHaveLength(2);
    expect(h.baris).toHaveLength(0);
  });

  it("urutan kolom boleh berubah — header yang dibaca, bukan posisinya", () => {
    const h = uraiAlokasiCore(
      "service,fo_id,usage,label,next_hop,dari,warna_tube\nMetro E,1,Uplink TBG,TUBE 1 - CORE 1,To Belong,To RK,BLUE",
      1,
    );
    expect(h.baris[0].service).toBe("Metro E");
    expect(h.baris[0].usage).toBe("Uplink TBG");
    expect(h.baris[0].nextHop).toBe("To Belong");
  });

  it("nilai berkoma di dalam tanda kutip tidak terbelah", () => {
    const h = uraiAlokasiCore(`${KEPALA}\n1,TUBE 1 - CORE 1,BLUE,,,"Uplink, cadangan",Metro E`, 1);
    expect(h.baris[0].usage).toBe("Uplink, cadangan");
    expect(h.baris[0].service).toBe("Metro E");
  });

  it("CSV kosong tidak melempar", () => {
    expect(uraiAlokasiCore("", 0)).toEqual({ baris: [], masalah: [] });
  });

  it("hasilnya terurut per FO ID walau sheetnya acak", () => {
    const h = uraiAlokasiCore(`${KEPALA}\n3,TUBE 1 - CORE 3,BLUE,,,,\n1,TUBE 1 - CORE 1,BLUE,,,,\n2,TUBE 1 - CORE 2,BLUE,,,,`, 3);
    expect(h.baris.map((b) => b.foId)).toEqual([1, 2, 3]);
  });
});

describe("warna", () => {
  it("WARNA_TABUNG identik dengan WARNA_CORE di skema", () => {
    // Dua daftar yang berbeda satu urutan saja akan memberi warna berbeda
    // untuk serat yang sama antara pengimpor dan `buatKabel` — dan tidak ada
    // yang melempar galat.
    expect([...WARNA_TABUNG]).toEqual([...WARNA_CORE]);
    expect(WARNA_TABUNG).toHaveLength(SERAT_PER_TABUNG);
  });

  it("urutannya TIA-598, cocok dengan sheet lapangan", () => {
    // Sheet menulis BLUE, ORANGE, GREEN, BROWN, GRAY, WHITE, RED, BLACK,
    // YELLOW, PURPLE, PINK, TOSCA — urutan itu yang dipakai teknisi.
    expect(WARNA_TABUNG[0]).toBe("biru");
    expect(WARNA_TABUNG[4]).toBe("abu-abu");
    expect(WARNA_TABUNG[9]).toBe("ungu");
    expect(WARNA_TABUNG[11]).toBe("tosca");
  });
});

describe("catatanCore", () => {
  it("merangkai hanya kolom yang terisi", () => {
    const c = catatanCore({
      foId: 1, tubeNumber: 1, coreInTube: 1, color: "biru", label: "TUBE 1 - CORE 1",
      dari: "To RK Jalur 11", nextHop: "To Belong", usage: "Uplink TBG", service: "Metro E Via TBG",
    });
    expect(c).toBe("Dari: To RK Jalur 11 · Next hop: To Belong · Pemakaian: Uplink TBG · Layanan: Metro E Via TBG");
  });

  it("core tanpa alokasi bercatatan NULL, bukan kalimat karangan", () => {
    // "Belum dipakai" mengubah ketiadaan catatan jadi pernyataan yang tidak
    // pernah dibuat siapa pun.
    const c = catatanCore({
      foId: 100, tubeNumber: 9, coreInTube: 4, color: "coklat", label: "TUBE 9 - CORE 9",
      dari: "", nextHop: "", usage: "", service: "",
    });
    expect(c).toBeNull();
  });
});
