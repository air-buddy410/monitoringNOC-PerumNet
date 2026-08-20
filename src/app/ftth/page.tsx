import type { Metadata } from "next";
import FtthPage from "@/components/operations/ftth-page";

export const metadata: Metadata = {
  title: "FTTH / ODP • PerumNet NOC",
  description: "Pantau ODP dan port FTTH PerumNet.",
};

export default function Page() {
  return <FtthPage />;
}
