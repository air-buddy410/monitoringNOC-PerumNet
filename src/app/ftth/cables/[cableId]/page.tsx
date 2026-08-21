import type { Metadata } from "next";
import { FiberCableDetailPage } from "@/components/operations/fiber-page";

export const metadata: Metadata = {
  title: "Detail Kabel • PerumNet NOC",
  description: "Detail core dan status terminasi bentangan kabel FTTH.",
};

export default async function Page({
  params,
}: {
  params: Promise<{ cableId: string }>;
}) {
  const { cableId } = await params;
  return <FiberCableDetailPage cableId={cableId} />;
}
