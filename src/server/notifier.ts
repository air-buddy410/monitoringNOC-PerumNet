// Layanan pengiriman notifikasi (Alert Dispatcher pada arsitektur PRD).
//
// Provider per platform:
// - Telegram : Bot API resmi bila TELEGRAM_BOT_TOKEN di-set.
// - WhatsApp : gateway HTTP (Baileys in-house / WA Business API) bila
//              WHATSAPP_API_URL di-set.
// Tanpa konfigurasi, pengiriman berjalan dalam MODE SIMULASI (dicatat di
// tabel audit) supaya alur tetap bisa diuji end-to-end. Target yang diakhiri
// "-fail" sengaja digagalkan untuk menguji jalur error.
//
// Mulai Fase 4 setiap pengiriman dicatat ke `notification_deliveries`
// (terkait incidentId); tabel `notification_logs` tetap dipertahankan sebagai
// LEGACY-AKTIF untuk UI riwayat lama sampai Fase 7 lalu dihapus.

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notificationChannels, notificationDeliveries } from "@/db/schema";

type ChannelRow = typeof notificationChannels.$inferSelect;

export interface AlertPayload {
  librenmsAlertId: string;
  deviceName: string;
  message: string;
  /** ID incident di tabel incidents; kosong bila tidak ada (mis. recovery
   * tanpa incident aktif) → kolom incident_id delivery bernilai null. */
  incidentId?: string;
}

interface SendOutcome {
  ok: boolean;
  detail: string;
}

async function sendTelegram(
  channel: ChannelRow,
  message: string,
): Promise<SendOutcome> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const recipient = channel.chatId ?? channel.target;

  if (!token) {
    if (recipient.endsWith("-fail")) {
      return { ok: false, detail: "simulasi: pengiriman digagalkan" };
    }
    console.log(`[notifier] (simulasi) Telegram → ${recipient}: ${message}`);
    return { ok: true, detail: "simulasi" };
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: recipient, text: message }),
    },
  );
  if (!response.ok) {
    return { ok: false, detail: `Telegram API ${response.status}` };
  }
  return { ok: true, detail: "telegram-bot-api" };
}

async function sendWhatsApp(
  channel: ChannelRow,
  message: string,
): Promise<SendOutcome> {
  const gatewayUrl = process.env.WHATSAPP_API_URL;
  const recipient = channel.chatId ?? channel.target;

  if (!gatewayUrl) {
    if (recipient.endsWith("-fail")) {
      return { ok: false, detail: "simulasi: pengiriman digagalkan" };
    }
    console.log(`[notifier] (simulasi) WhatsApp → ${recipient}: ${message}`);
    return { ok: true, detail: "simulasi" };
  }

  const response = await fetch(gatewayUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.WHATSAPP_API_TOKEN
        ? { Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({ to: recipient, message }),
  });
  if (!response.ok) {
    return { ok: false, detail: `WA gateway ${response.status}` };
  }
  return { ok: true, detail: "wa-gateway" };
}

export interface DispatchResult {
  sent: number;
  failed: number;
  skipped: number;
  logIds: string[];
}

/**
 * Kirim satu alert ke SEMUA channel terverifikasi & aktif, lalu catat hasil
 * per channel ke notification_deliveries (terkait incident aktif).
 */
export async function dispatchAlert(
  payload: AlertPayload,
): Promise<DispatchResult> {
  const channels = (
    await db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.active, true))
  ).filter((channel) => channel.verified);

  const result: DispatchResult = {
    sent: 0,
    failed: 0,
    skipped: 0,
    logIds: [],
  };

  for (const channel of channels) {
    let outcome: SendOutcome;
    try {
      outcome =
        channel.type === "telegram"
          ? await sendTelegram(channel, payload.message)
          : await sendWhatsApp(channel, payload.message);
    } catch (error) {
      outcome = { ok: false, detail: String(error) };
    }

    const deliveryId = randomUUID();
    await db.insert(notificationDeliveries).values({
      id: deliveryId,
      incidentId: payload.incidentId || null,
      channelId: channel.id,
      channelType: channel.type,
      target: channel.chatId ?? channel.target,
      status: outcome.ok ? "sent" : "failed",
      detail: outcome.detail,
      createdAt: new Date(),
    });

    result.logIds.push(deliveryId);
    if (outcome.ok) result.sent += 1;
    else result.failed += 1;
  }

  return result;
}
