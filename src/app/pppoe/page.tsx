import type { Metadata } from "next";
import PppoePage from "@/components/operations/pppoe-page";

export const metadata: Metadata = {
  title: "Sesi PPPoE • PerumNet NOC",
  description: "Pantau sesi PPPoE dari penarikan router terakhir.",
};

export default function Page() {
  return <PppoePage />;
}
