import type { Metadata } from "next";
import CustomerStatusView from "@/components/customer/customer-status-view";

export const metadata: Metadata = {
  title: "Status Layanan • PerumNet",
  description: "Pantau status layanan internet PerumNet Anda.",
};

export default async function CustomerStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; serviceId?: string; token?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-8">
      <CustomerStatusView
        customerId={params.customerId ?? ""}
        serviceId={params.serviceId ?? ""}
        token={params.token ?? ""}
      />
    </main>
  );
}
