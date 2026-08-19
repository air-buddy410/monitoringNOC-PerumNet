// Unit penjaga aksi keluar + perilaku dispatchAlert di bawah mode baca-saja.
//
// Catatan tentang merah-hijau (docs/WORKFLOW-TIM.md §4): tes pada blok
// "mode baca-saja" di bawah TIDAK bisa dibuat merah terhadap kode sebelum
// perubahan — modulnya belum ada, jadi yang gagal adalah import, bukan
// perilakunya. Merah yang bermakna sudah dibuktikan di
// tests/no-outward-fetch-guard.test.ts (menyebut crm-webhook.ts & notifier.ts)
// dan di tests/crm-customer.test.ts. Blok "simulasi tidak ikut diblokir"
// memang lulus sebelum & sesudah — itu penjaga regresi, bukan bukti penegakan.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));

import * as schema from "@/db/schema";
import {
  OutwardBlockedError,
  configuredOutwardChannels,
  isOutwardBlocked,
  outwardFetch,
  outwardMode,
  recordOutwardBlocked,
} from "@/server/outward-guard";
import { dispatchAlert } from "@/server/notifier";

const MIGRATION_DIR = path.resolve(__dirname, "..", "drizzle", "pg");
const migrationSql = readdirSync(MIGRATION_DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(path.join(MIGRATION_DIR, file), "utf8"))
  .join("\n");

let client: PGlite;

beforeAll(async () => {
  client = new PGlite();
  await client.exec(migrationSql);
  mocks.db = drizzle(client, { schema });
  await client.query(
    `INSERT INTO notification_channels (id, type, recipient_name, target, chat_id, verified, active)
     VALUES ('ch-tg', 'telegram', 'NOC Piket', 'noc-piket', '12345', true, true)`,
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("outwardMode — bawaannya memblokir", () => {
  it("tidak diisi → BLOCKED", () => {
    expect(outwardMode()).toBe("BLOCKED");
    expect(isOutwardBlocked()).toBe(true);
  });

  it("kosong → BLOCKED", () => {
    vi.stubEnv("OUTWARD_ACTIONS", "");
    expect(outwardMode()).toBe("BLOCKED");
  });

  it.each(["ALLOWED", "allowed", "  ALLOWED  "])(
    "%s → ALLOWED",
    (value) => {
      vi.stubEnv("OUTWARD_ACTIONS", value);
      expect(outwardMode()).toBe("ALLOWED");
    },
  );

  // Ini kasus yang paling berharga: nilai yang NIATNYA membuka, tapi salah
  // tulis, harus jatuh ke sisi yang aman — bukan ke sisi yang mengirim pesan.
  it.each(["ALOWED", "true", "yes", "1", "BLOCKED"])(
    "%s (tak dikenal) → BLOCKED",
    (value) => {
      vi.stubEnv("OUTWARD_ACTIONS", value);
      expect(outwardMode()).toBe("BLOCKED");
    },
  );
});

describe("outwardFetch", () => {
  it("mode BLOCKED → melempar dan fetch TIDAK PERNAH dipanggil", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);

    await expect(
      outwardFetch("telegram", "https://api.telegram.org/botX/sendMessage"),
    ).rejects.toBeInstanceOf(OutwardBlockedError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("mode ALLOWED → diteruskan apa adanya", async () => {
    vi.stubEnv("OUTWARD_ACTIONS", "ALLOWED");
    const response = { ok: true, status: 200 } as Response;
    const spy = vi.fn(async () => response);
    vi.stubGlobal("fetch", spy);

    const init = { method: "POST" };
    await expect(
      outwardFetch("crm-webhook", "https://crm.example.test/hook", init),
    ).resolves.toBe(response);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("https://crm.example.test/hook", init);
  });
});

describe("configuredOutwardChannels", () => {
  it("menurunkan boolean dari ada/tidaknya env, tanpa memuat nilainya", () => {
    vi.stubEnv("CRM_WEBHOOK_URL", "https://crm.example.test/hook");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const configured = configuredOutwardChannels();
    expect(configured).toEqual({
      "crm-webhook": true,
      telegram: false,
      whatsapp: false,
    });
    expect(JSON.stringify(configured)).not.toContain("crm.example.test");
  });
});

describe("recordOutwardBlocked", () => {
  it("menulis satu baris audit outward.blocked", async () => {
    await recordOutwardBlocked("whatsapp", { type: "incident", id: "inc-guard-1" });
    const rows = await client.query<{ action: string; actor_label: string }>(
      "SELECT action, actor_label FROM audit_logs WHERE entity_id = 'inc-guard-1'",
    );
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0].action).toBe("outward.blocked");
    expect(rows.rows[0].actor_label).toBe("system:outward-guard");
  });

  it("database bermasalah TIDAK boleh melempar — ingress tidak boleh ikut jatuh", async () => {
    const broken = { insert: () => { throw new Error("db mati"); } };
    const previous = mocks.db;
    mocks.db = broken;
    try {
      await expect(
        recordOutwardBlocked("telegram", { type: "incident", id: "inc-guard-2" }),
      ).resolves.toBeUndefined();
    } finally {
      mocks.db = previous;
    }
  });
});

describe("dispatchAlert di bawah mode baca-saja", () => {
  const payload = {
    librenmsAlertId: "alert-guard-1",
    deviceName: "core-1",
    message: "Device down",
  };

  it("simulasi (tanpa token) TIDAK ikut diblokir — riwayat tetap terisi", async () => {
    // Regresi: inilah yang paling mudah rusak saat penjaga digeser terlalu awal.
    const result = await dispatchAlert(payload);
    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);

    const rows = await client.query<{ n: string }>(
      "SELECT count(*) AS n FROM notification_deliveries WHERE detail = 'simulasi'",
    );
    expect(Number(rows.rows[0].n)).toBeGreaterThanOrEqual(1);
  });

  it("transport nyata + mode BLOCKED → skipped, tanpa baris delivery, tanpa fetch", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot-token-nyata");
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);

    const before = await client.query<{ n: string }>(
      "SELECT count(*) AS n FROM notification_deliveries",
    );

    const result = await dispatchAlert({ ...payload, librenmsAlertId: "alert-guard-2" });
    expect(result.skipped).toBe(1);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(spy).not.toHaveBeenCalled();

    // Tidak menambah baris riwayat: "gagal" akan jadi tembok palsu, "terkirim"
    // adalah kebohongan. Yang benar adalah tidak ada pengiriman untuk dicatat.
    const after = await client.query<{ n: string }>(
      "SELECT count(*) AS n FROM notification_deliveries",
    );
    expect(Number(after.rows[0].n)).toBe(Number(before.rows[0].n));

    const audit = await client.query<{ n: string }>(
      "SELECT count(*) AS n FROM audit_logs WHERE action = 'outward.blocked' AND entity_id = 'alert-guard-2'",
    );
    expect(Number(audit.rows[0].n)).toBe(1);
  });
});
