import type { Metadata } from "next";
import SitesPage from "@/components/operations/sites-page";

export const metadata: Metadata = {
  title: "Situs Jaringan • PerumNet NOC",
  description: "Direktori lokasi fisik jaringan PerumNet.",
};

export default function Page() {
  return <SitesPage />;
}
