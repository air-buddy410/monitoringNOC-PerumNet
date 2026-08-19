import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { notificationChannels } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * Rate limit per IP — bentuknya sama dengan webhook ingress LibreNMS
 * (src/app/api/v1/integrations/librenms/alerts/route.ts). In-memory per proses;
 * produksi multi-instance perlu Redis, dicatat di PRD Fase 4.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
const attempts = new Map<string, { count: number; windowStart: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    attempts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

interface VerifyBody {
  code?: string;
  chatId?: string;
}

/**
 * POST /api/notifications/channels/verify
 * Dipanggil bot saat menerima kode dari pengguna: mencocokkan kode
 * verifikasi lalu menautkan akun (chatId pengirim) ke channel. Channel yang
 * cocok menjadi terverifikasi & aktif menerima alert.
 *
 * KEAMANAN. Rute ini tidak punya sesi — pemanggilnya bot, bukan orang yang
 * login. Sampai 19 Agustus 2026 kendalinya hanya kode 6 digit yang tidak pernah
 * kedaluwarsa, tanpa rate limit, pada host yang terbuka di internet: siapa pun
 * bisa menebaknya beruntun lalu menautkan chatId miliknya ke channel yang
 * sedang menunggu, dan sejak itu menerima alert NOC. Sekarang wajib membawa
 * `x-bot-token` = `NOTIFICATION_BOT_SECRET`.
 *
 * Tokennya WAJIB, bukan opsional. Pola lunak `if (secret && …)` seperti webhook
 * LibreNMS berarti lupa mengisi env = pintu terbuka lebar, dan diamnya tidak
 * terlihat dari mana pun. Belum ada bot yang berjalan di produksi, jadi
 * mewajibkannya sekarang tidak memutus siapa pun.
 */
export async function POST(request: Request) {
  const secret = process.env.NOTIFICATION_BOT_SECRET?.trim();
  if (!secret) {
    console.error(
      "[channels/verify] NOTIFICATION_BOT_SECRET belum diisi — verifikasi channel ditutup.",
    );
    return NextResponse.json(
      { error: "Verifikasi channel belum dikonfigurasi di server." },
      { status: 503 },
    );
  }
  if (request.headers.get("x-bot-token") !== secret) {
    return NextResponse.json({ error: "Token bot tidak valid." }, { status: 401 });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "Terlalu banyak percobaan verifikasi." },
      { status: 429 },
    );
  }

  let body: VerifyBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body harus JSON yang valid." },
      { status: 400 },
    );
  }

  const code = body.code?.trim();
  const chatId = body.chatId?.trim();
  if (!code || !chatId) {
    return NextResponse.json(
      { error: "code dan chatId wajib diisi." },
      { status: 400 },
    );
  }

  const [channel] = await db
    .select()
    .from(notificationChannels)
    .where(
      and(
        eq(notificationChannels.verificationCode, code),
        eq(notificationChannels.verified, false),
      ),
    )
    .limit(1);

  if (!channel) {
    return NextResponse.json(
      { error: "Kode verifikasi tidak dikenal atau sudah dipakai." },
      { status: 404 },
    );
  }

  await db
    .update(notificationChannels)
    .set({
      verified: true,
      active: true,
      verificationCode: null,
      chatId,
    })
    .where(eq(notificationChannels.id, channel.id));

  return NextResponse.json({
    channel: {
      id: channel.id,
      type: channel.type,
      recipientName: channel.recipientName,
      target: channel.target,
      verified: true,
      active: true,
      chatId,
    },
  });
}
