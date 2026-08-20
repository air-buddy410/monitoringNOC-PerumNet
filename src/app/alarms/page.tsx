import type { Metadata } from "next";
import AlarmsPage from "@/components/operations/alarms-page";

export const metadata: Metadata = {
  title: "Alarm Probe • PerumNet NOC",
  description: "Alarm keterjangkauan yang disimpulkan dari probe portal.",
};

export default function Page() {
  return <AlarmsPage />;
}
