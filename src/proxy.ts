// Proxy (Next 16) — gerbang autentikasi halaman Portal.
//
// Menjalankan Node.js runtime (default Next 16), sehingga dapat memverifikasi
// sesi Better Auth langsung lewat `auth.api.getSession` (database-backed).
// Halaman internal di-redirect ke /login bila belum login; API internal tetap
// dijaga RBAC masing-masing (tidak di-guard di sini — termasuk webhook
// ingress yang memakai header secret, bukan sesi).
//
// Referensi: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/server/auth";

const PUBLIC_PATHS = ["/login", "/register", "/customer"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    PUBLIC_PATHS.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    )
  ) {
    return NextResponse.next();
  }

  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("callbackUrl", pathname + request.nextUrl.search);
      return NextResponse.redirect(loginUrl);
    }
  } catch (error) {
    // Sesi tidak dapat diverifikasi (mis. DB sedang gangguan) — biarkan
    // halaman lewat; endpoint API tetap menolak tanpa sesi yang valid.
    console.error("[proxy] gagal memverifikasi sesi:", error);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Halaman internal saja; API (`/api/*`) TIDAK di-guard di sini — setiap
    // endpoint dijaga RBAC-nya sendiri (webhook ingress memakai header
    // secret, customer portal memakai deep-link, sisanya memakai sesi).
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.png|apple-icon\\.png|manifest\\.webmanifest|brand|file\\.svg|globe\\.svg|next\\.svg|vercel\\.svg|window\\.svg|login|register|customer|api).*)",
  ],
};
