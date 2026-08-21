import type { Metadata } from "next";
import { ClosureDirectoryPage } from "@/components/operations/closure-page";

export const metadata: Metadata = {
  title: "FTTH / Closure • PerumNet NOC",
  description: "Daftar closure dan matriks silangan core FTTH.",
};

export default function Page() {
  return <ClosureDirectoryPage />;
}
