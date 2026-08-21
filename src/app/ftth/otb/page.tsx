import type { Metadata } from "next";
import { OtbDirectoryPage } from "@/components/operations/otb-page";

export const metadata: Metadata = {
  title: "FTTH / OTB • PerumNet NOC",
  description: "Daftar OTB dan ringkasan inventori tray jaringan FTTH.",
};

export default function Page() {
  return <OtbDirectoryPage />;
}
