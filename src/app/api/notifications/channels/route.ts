import { randomInt, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { notificationChannels } from "@/db/schema";
import { withRole } from "@/server/rbac";

export const dynamic = "force-dynamic";

/** GET /api/notifications/channels — daftar channel terdaftar (perlu login). */
export const GET = withRole([], async () => {
  const channels = await db
    .select({
      id: notificationChannels.id,
      type: notificationChannels.type,
      recipientName: notificationChannels.recipientName,
      target: notificationChannels.target,
      verified: notificationChannels.verified,
      active: notificationChannels.active,
      createdAt: notificationChannels.createdAt,
    })
    .from(notificationChannels)
    .orderBy(desc(notificationChannels.createdAt))
    ;

  return NextResponse.json({ channels, total: channels.length });
});

const VALID_TYPES = ["telegram", "whatsapp"] as const;
type ChannelType = (typeof VALID_TYPES)[number];

interface RegisterBody {
  type?: string;
  recipientName?: string;
  target?: string;
}

/**
 * POST /api/notifications/channels
 * Mendaftarkan channel bot baru dan menerbitkan kode verifikasi 6 digit.
 * Channel berstatus belum-terverifikasi sampai kode dikonfirmasi bot.
 */
export const POST = withRole([], async (request) => {
  let body: RegisterBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body harus JSON yang valid." },
      { status: 400 },
    );
  }

  const type = body.type?.trim() as ChannelType | undefined;
  const recipientName = body.recipientName?.trim();
  const target = body.target?.trim();

  if (!type || !VALID_TYPES.includes(type)) {
    return NextResponse.json(
      { error: `type wajib salah satu dari: ${VALID_TYPES.join(", ")}` },
      { status: 400 },
    );
  }
  if (!recipientName || !target) {
    return NextResponse.json(
      { error: "recipientName dan target wajib diisi." },
      { status: 400 },
    );
  }

  const [existing] = await db
    .select({ id: notificationChannels.id })
    .from(notificationChannels)
    .where(
      and(
        eq(notificationChannels.type, type),
        eq(notificationChannels.target, target),
      ),
    )
    .limit(1);
  if (existing) {
    return NextResponse.json(
      { error: `Target ${target} (${type}) sudah terdaftar.` },
      { status: 409 },
    );
  }

  // CSPRNG, bukan Math.random: kode ini satu-satunya hal yang berdiri antara
  // orang luar dan hak menerima alert NOC.
  const verificationCode = String(randomInt(100000, 1000000));
  const channel = {
    id: randomUUID(),
    type,
    recipientName,
    target,
    verified: false,
    active: false,
    verificationCode,
  };
  await db.insert(notificationChannels).values(channel);

  return NextResponse.json(
    {
      channel: {
        id: channel.id,
        type,
        recipientName,
        target,
        verified: false,
        active: false,
      },
      verificationCode,
    },
    { status: 201 },
  );
});
