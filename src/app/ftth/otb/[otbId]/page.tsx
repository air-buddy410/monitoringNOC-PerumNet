import type { Metadata } from "next";
import { OtbDetailPage } from "@/components/operations/otb-page";

export const metadata: Metadata = {
  title: "Detail OTB • PerumNet NOC",
  description: "Detail tray dan inventori port OTB jaringan FTTH.",
};

export default async function Page({
  params,
}: {
  params: Promise<{ otbId: string }>;
}) {
  const { otbId } = await params;
  return <OtbDetailPage otbId={otbId} />;
}
