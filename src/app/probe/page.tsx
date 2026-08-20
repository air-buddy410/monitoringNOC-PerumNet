import type { Metadata } from "next";
import ProbePage from "@/components/operations/probe-page";

export const metadata: Metadata = {
  title: "Probe • PerumNet NOC",
  description: "Pantau sasaran probe TCP dan kesehatan worker PerumNet NOC.",
};

export default function Page() {
  return <ProbePage />;
}
