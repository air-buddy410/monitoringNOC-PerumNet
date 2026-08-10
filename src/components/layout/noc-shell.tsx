"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Bell,
  BarChart3,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  LayoutDashboard,
  Map,
  Menu,
  Network,
  Search,
  UserRound,
  Users,
  Wifi,
  X,
} from "lucide-react";
import LogoutButton from "@/components/logout-button";
import { useSession } from "@/hooks/use-session";

const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/devices", label: "Perangkat", icon: Wifi },
  { href: "/map", label: "Peta Jaringan", icon: Map },
  { href: "/topology", label: "Topologi", icon: Network },
  { href: "/notifications", label: "Notifikasi", icon: Bell },
  { href: "/reports", label: "Laporan", icon: ClipboardList },
  { href: "/users", label: "Pengguna", icon: Users },
];

const pageNames: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/devices": "Perangkat",
  "/map": "Peta Jaringan",
  "/topology": "Topologi",
  "/notifications": "Notifikasi",
  "/reports": "Laporan",
  "/users": "Pengguna",
  "/profile": "Profil",
};

function currentPage(pathname: string) {
  if (pathname.startsWith("/devices/")) return "Perangkat";
  return pageNames[pathname] ?? "Dashboard";
}

export default function NocShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { session, isLoading: isSessionLoading } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const isPublicPage = pathname === "/login" || pathname === "/register";

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
              (href === "/devices" && pathname.startsWith("/devices/"));
            return (
              <Link
                key={label}
                href={href}
                className={`noc-nav-link ${isActive ? "is-active" : ""}`}
                onClick={() => setMenuOpen(false)}
              >
                <Icon aria-hidden="true" />
                <span>{label}</span>
                {label === "Notifikasi" && <b>12</b>}
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
          <label className="noc-search">
            <Search aria-hidden="true" />
            <input placeholder="Cari perangkat, lokasi, IP, atau ID" />
          </label>
          <div className="noc-topbar-status">
            <span />
            Live
          </div>
          <div className="noc-topbar-actions">
            <Link href="/notifications" aria-label="Notifikasi">
              <Bell aria-hidden="true" />
              <b>12</b>
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
        <div className="noc-content">{children}</div>
      </div>
    </div>
  );
}
