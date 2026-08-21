import type { Metadata } from "next";
import { ClosureDetailPage } from "@/components/operations/closure-page";

export const metadata: Metadata = {
  title: "Detail Closure • PerumNet NOC",
  description: "Matriks silangan dan riwayat closure jaringan FTTH.",
};

export default async function Page({
  params,
}: {
  params: Promise<{ closureId: string }>;
}) {
  const { closureId } = await params;
  return <ClosureDetailPage closureId={closureId} />;
}
