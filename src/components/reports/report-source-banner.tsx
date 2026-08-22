import { Check, FlaskConical, CircleHelp } from "lucide-react";

export type ReportSource = "terukur" | "fixture" | "belum-ada-data";

const SOURCE_COPY: Record<ReportSource, { title: string; body: string; Icon: typeof Check }> = {
  "belum-ada-data": {
    title: "Belum ada rekap untuk periode ini",
    body: "Laporan kosong bukan berarti jaringan tidak mengalami gangguan atau trafiknya nol. Rekap pengukuran belum tersedia dari sumber data.",
    Icon: CircleHelp,
  },
  fixture: {
    title: "Data contoh",
    body: "Angka pada laporan ini dibangkitkan untuk pengembangan dan bukan hasil pengukuran jaringan produksi.",
    Icon: FlaskConical,
  },
  terukur: {
    title: "Data terukur",
    body: "Angka berasal dari rekap pengukuran jaringan.",
    Icon: Check,
  },
};

export default function ReportSourceBanner({ source }: { source: ReportSource }) {
  const copy = SOURCE_COPY[source];
  const Icon = copy.Icon;
  return (
    <div className={`noc-report-source is-${source}`} role="status">
      <Icon aria-hidden="true" />
      <div><strong>{copy.title}</strong><span>{copy.body}</span></div>
    </div>
  );
}
