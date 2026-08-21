import type { Metadata } from "next";
import { FiberCableDirectoryPage } from "@/components/operations/fiber-page";

export const metadata: Metadata = {
  title: "FTTH / Kabel • PerumNet NOC",
  description: "Daftar bentangan kabel dan inventori core FTTH.",
};

export default function Page() {
  return <FiberCableDirectoryPage />;
}
