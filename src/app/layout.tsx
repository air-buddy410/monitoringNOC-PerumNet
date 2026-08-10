import type { Metadata, Viewport } from "next";
import { DM_Sans, Plus_Jakarta_Sans } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import NocShell from "@/components/layout/noc-shell";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-perumnet-body",
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-perumnet-heading",
});

export const metadata: Metadata = {
  title: "PerumNet NOC",
  description:
    "Dashboard monitoring jaringan PerumNet untuk NOC ISP.",
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [
      { url: "/favicon.ico", type: "image/x-icon", sizes: "32x32" },
      { url: "/brand/perumnet-mark-192.png", type: "image/png", sizes: "192x192" },
      { url: "/brand/perumnet-mark-512.png", type: "image/png", sizes: "512x512" },
      ],
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="id"
      suppressHydrationWarning
      className={`${dmSans.variable} ${plusJakartaSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <NocShell>{children}</NocShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
