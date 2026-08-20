import type { Metadata } from "next";
import ConsolePage from "@/components/operations/console-page";

export const metadata: Metadata = {
  title: "Konsol perangkat • PerumNet NOC",
  description: "Konsol perangkat baca-saja yang tercatat untuk operator NOC.",
};

export default function ConsoleRoute() {
  return <ConsolePage />;
}
