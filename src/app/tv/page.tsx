import type { Metadata } from "next";
import TvWallboard from "@/components/tv/tv-wallboard";

export const metadata: Metadata = {
  title: "Wallboard NOC • PerumNet",
  description: "Wallboard monitoring jaringan PerumNet untuk ruang NOC.",
};

export default function TvPage() {
  return <TvWallboard />;
}
