import type { Metadata } from "next";
import IpamPage from "@/components/operations/ipam-page";

export const metadata: Metadata = {
  title: "IPAM • PerumNet NOC",
  description: "Kelola subnet dan alamat IP jaringan PerumNet.",
};

export default function Page() {
  return <IpamPage />;
}
