"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import useSWR from "swr";
import {
  Archive,
  Bell,
  BarChart3,
  Box,
  Cable,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Database,
  Gauge,
  GitBranch,
  LayoutDashboard,
  Map,
  MapPinned,
  Menu,
  Network,
  Router,
  Search,
  ShieldCheck,
  Terminal,
  TriangleAlert,
  UserRound,
  Users,
  Wifi,
  X,
} from "lucide-react";
import LogoutButton from "@/components/logout-button";
import { useBackupFreshness } from "@/hooks/use-backup-freshness";
import { useReadOnlyMode } from "@/hooks/use-read-only-mode";
import { useSession } from "@/hooks/use-session";
import { getJson } from "@/lib/api/http";
import type {
  IncidentsResponse,
  LibrenmsStatusResponse,
} from "@/server/api-v1/contracts";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function useLibrenmsLive(enabled = true): {
  data?: LibrenmsStatusResponse;
  loading: boolean;
  error?: unknown;
} {
  const { data, isLoading, error } = useSWR<LibrenmsStatusResponse>(
    enabled ? "/api/v1/integrations/librenms/status" : null,
    getJson<LibrenmsStatusResponse>,
    { refreshInterval: 30_000, revalidateOnFocus: false, refreshWhenHidden: true },
  );
  return { data, loading: isLoading, error };
}

function useActiveIncidentCount(enabled = true): number {
  const { session } = useSession(enabled);
  const { data } = useSWR<IncidentsResponse>(
    enabled && session ? "/api/v1/incidents?limit=50" : null,
    fetcher,
    { refreshInterval: 30_000, revalidateOnFocus: false, refreshWhenHidden: true },
  );
  return data?.incidents.filter((incident) => incident.state !== "resolved").length ?? 0;
}

const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/devices", label: "Perangkat", icon: Wifi },
  { href: "/map", label: "Peta Jaringan", icon: Map },
  { href: "/topology", label: "Topologi", icon: Network },
  { href: "/notifications", label: "Notifikasi", icon: Bell },
  { href: "/reports", label: "Laporan", icon: ClipboardList },
  { href: "/users", label: "Pengguna", icon: Users },
  { href: "/sites", label: "Situs", icon: MapPinned },
  { href: "/ipam", label: "IPAM", icon: Database },
  { href: "/ftth", label: "FTTH", icon: Cable },
  { href: "/ftth/otb", label: "OTB", icon: Box },
  { href: "/ftth/cables", label: "Kabel FTTH", icon: Cable },
  { href: "/ftth/closures", label: "Closure FTTH", icon: GitBranch },
  { href: "/pppoe", label: "PPPoE", icon: Router },
  { href: "/probe", label: "Probe", icon: Gauge },
  { href: "/alarms", label: "Alarm", icon: TriangleAlert },
  { href: "/console", label: "Konsol", icon: Terminal },
];

const pageNames: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/devices": "Perangkat",
  "/map": "Peta Jaringan",
  "/topology": "Topologi",
  "/notifications": "Notifikasi",
  "/reports": "Laporan",
  "/users": "Pengguna",
  "/sites": "Situs",
  "/ipam": "IPAM",
  "/ftth": "FTTH",
  "/ftth/otb": "OTB",
  "/ftth/cables": "Kabel FTTH",
  "/ftth/closures": "Closure FTTH",
  "/pppoe": "PPPoE",
  "/probe": "Probe",
  "/alarms": "Alarm",
  "/console": "Konsol",
  "/profile": "Profil",
};

function currentPage(pathname: string) {
  if (pathname.startsWith("/devices/")) return "Perangkat";
  if (pathname === "/ftth/otb" || pathname.startsWith("/ftth/otb/")) return "OTB";
  if (pathname === "/ftth/cables" || pathname.startsWith("/ftth/cables/")) return "Kabel FTTH";
  if (pathname === "/ftth/closures" || pathname.startsWith("/ftth/closures/")) return "Closure FTTH";
  return pageNames[pathname] ?? "Dashboard";
}

export default function NocShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const isPublicPage =
    pathname === "/login" ||
    pathname === "/register" ||
    pathname.startsWith("/customer/") ||
    pathname === "/customer";
  const { session, isLoading: isSessionLoading } = useSession(!isPublicPage);
  const { data: readOnlyMode } = useReadOnlyMode(Boolean(session) && !isPublicPage);
  const { data: backupFreshness } = useBackupFreshness(Boolean(session) && !isPublicPage);

  useEffect(() => {
    if (!menuOpen) return;

    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!profileOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileOpen(false);
    };
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeOnOutsidePress);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("pointerdown", closeOnOutsidePress);
    };
  }, [profileOpen]);

  const incidentCount = useActiveIncidentCount(!isPublicPage);
  const librenmsLive = useLibrenmsLive(!isPublicPage);
  const librenmsLabel = librenmsLive.loading && !librenmsLive.data
    ? "..."
    : librenmsLive.data
      ? !librenmsLive.data.configured
        ? "Data contoh"
        : librenmsLive.data.reachable
          ? "Live"
          : "Offline"
      : "Tidak tersedia";
  const librenmsColor = !librenmsLive.data
    ? "#94a3b8"
    : !librenmsLive.data.configured
      ? "#fab219"
      : librenmsLive.data.reachable
        ? "#22c55e"
        : "#d03b3b";
  const librenmsTitle = librenmsLive.data
    ? !librenmsLive.data.configured
      ? "LibreNMS belum dikonfigurasi — angka menggunakan data contoh"
      : librenmsLive.data.reachable
        ? "LibreNMS terhubung"
        : "LibreNMS tidak terjangkau"
    : librenmsLive.error
      ? "Status LibreNMS tidak dapat dibaca"
      : "Memeriksa status LibreNMS";

  if (isPublicPage) return <>{children}</>;

  const title = currentPage(pathname);
  const accountName = session?.user.name ?? (isSessionLoading ? "Memuat akun" : "Belum masuk");
  const accountEmail = session?.user.email ?? "Masuk untuk melanjutkan";
  const accountInitials = session?.user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase() ?? "?";

  function toggleMenu() {
    setMenuOpen((value) => !value);
  }

  return (
    <div className="noc-shell">
      {menuOpen && (
        <button
          className="noc-sidebar-backdrop"
          aria-label="Tutup menu"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside id="noc-sidebar" className={`noc-sidebar ${menuOpen ? "is-open" : ""}`}>
        <button
          type="button"
          className="noc-sidebar-close"
          aria-label="Tutup menu"
          onClick={() => setMenuOpen(false)}
        >
          <X aria-hidden="true" />
        </button>
        <div className="noc-brand">
          <Image
            src="/brand/perumnet-mark.png"
            alt=""
            width={34}
            height={40}
            priority
            className="noc-brand-mark"
          />
          <Image
            src="/brand/perumnet-wordmark.png"
            alt="PerumNet"
            width={122}
            height={17}
            priority
            className="noc-brand-wordmark"
          />
          <strong>NOC</strong>
        </div>
        <div className="noc-sidebar-rule" />
        <nav className="noc-navigation" aria-label="Navigasi utama">
          {navigation.map(({ href, label, icon: Icon }) => {
            const isActive =
              pathname === href ||
              (href === "/devices" && pathname.startsWith("/devices/")) ||
              (href === "/ftth/otb" && pathname.startsWith("/ftth/otb")) ||
              (href === "/ftth/cables" && pathname.startsWith("/ftth/cables")) ||
              (href === "/ftth/closures" && pathname.startsWith("/ftth/closures"));
            return (
              <Link
                key={label}
                href={href}
                className={`noc-nav-link ${isActive ? "is-active" : ""}`}
                onClick={() => setMenuOpen(false)}
              >
                <Icon aria-hidden="true" />
                <span>{label}</span>
                {label === "Notifikasi" && incidentCount > 0 && <b>{incidentCount}</b>}
              </Link>
            );
          })}
        </nav>
        <div className="noc-sidebar-footer">
          <span className="noc-avatar">{accountInitials}</span>
          <div>
            <strong>{accountName}</strong>
            <span>{accountEmail}</span>
          </div>
          <Link href="/profile" aria-label="Buka profil">
            <ChevronRight aria-hidden="true" />
          </Link>
        </div>
      </aside>

      <div className="noc-workspace">
        <header className="noc-topbar">
          <button
            type="button"
            className="noc-menu-button"
            aria-label={menuOpen ? "Tutup menu" : "Buka menu"}
            aria-controls="noc-sidebar"
            aria-expanded={menuOpen}
            onClick={toggleMenu}
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
          <div className="noc-breadcrumb">
            <span>Operasional</span>
            <i>/</i>
            <strong>{title}</strong>
          </div>
          <form
            className="noc-search"
            onSubmit={(event) => {
              event.preventDefault();
              const input = new FormData(event.currentTarget).get("search") as string;
              if (input.trim()) {
                router.push(`/devices?q=${encodeURIComponent(input.trim())}`);
              } else {
                router.push("/devices");
              }
            }}
          >
            <Search aria-hidden="true" />
            <input name="search" placeholder="Cari perangkat, lokasi, IP, atau ID" />
          </form>
          <div className="noc-topbar-status" title={librenmsTitle}>
            <span style={{ background: librenmsColor }} />
            {librenmsLabel}
          </div>
          <div className="noc-topbar-actions">
            <Link href="/notifications" aria-label="Notifikasi">
              <Bell aria-hidden="true" />
              {incidentCount > 0 && <b>{incidentCount}</b>}
            </Link>
            <Link href="/reports" aria-label="Laporan">
              <BarChart3 aria-hidden="true" />
            </Link>
            <div className="noc-profile-menu" ref={profileMenuRef}>
              <button
                type="button"
                className="noc-profile-toggle"
                aria-label="Buka menu akun"
                aria-haspopup="menu"
                aria-expanded={profileOpen}
                onClick={() => setProfileOpen((value) => !value)}
              >
                <UserRound aria-hidden="true" />
                <span>{accountName}</span>
                <ChevronDown aria-hidden="true" />
              </button>
              {profileOpen && (
                <div className="noc-profile-panel" role="menu" aria-label="Menu akun">
                  <Link href="/profile" role="menuitem" onClick={() => setProfileOpen(false)}>
                    <UserRound aria-hidden="true" />
                    Profil saya
                  </Link>
                  <span className="noc-profile-panel-rule" />
                  {session ? <LogoutButton /> : <Link href="/login" role="menuitem" onClick={() => setProfileOpen(false)}>Masuk</Link>}
                </div>
              )}
            </div>
          </div>
        </header>
        {(readOnlyMode?.readOnly || backupFreshness?.needsAttention) && (
          <div className="noc-shell-notices">
            {readOnlyMode?.readOnly && (
              <div className="noc-shell-notice is-read-only" title={readOnlyMode.reason}>
                <ShieldCheck aria-hidden="true" />
                <span><strong>Mode baca-saja</strong><span>{readOnlyMode.reason}</span></span>
              </div>
            )}
            {backupFreshness?.needsAttention && (
              <details className="noc-shell-notice is-backup-warning">
                <summary><Archive aria-hidden="true" /><span><strong>Cadangan perlu diperiksa</strong><span>{backupFreshness.apps.filter((app) => app.health !== "ok").length} aplikasi perlu perhatian</span></span><TriangleAlert aria-hidden="true" /></summary>
                <div className="noc-backup-details">
                  {backupFreshness.apps.filter((app) => app.health !== "ok").map((app) => (
                    <div key={app.key}><strong>{app.label}</strong><span>{app.reason}</span></div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
        <div className="noc-content">{children}</div>
      </div>
    </div>
  );
}
