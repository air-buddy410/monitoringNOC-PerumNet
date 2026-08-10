import type { Metadata } from "next";
import { Suspense } from "react";
import Image from "next/image";
import { LogIn } from "lucide-react";
import LoginForm from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Login • PerumNet NOC",
  description: "Masuk ke PerumNet Hotspot & Captive Portal Management System.",
};

export default function LoginPage() {
  return (
    <main className="hotspot-login-page">
      <div className="hotspot-login-wrap">
        <div className="hotspot-login-brand">
          <div className="hotspot-login-lockup">
            <Image
              src="/brand/perumnet-mark.png"
              alt=""
              width={48}
              height={56}
              priority
              className="hotspot-login-mark"
            />
            <Image
              src="/brand/perumnet-wordmark.png"
              alt="PerumNet"
              width={180}
              height={24}
              priority
              className="hotspot-login-wordmark"
            />
          </div>
          <span>MONITORING NOC</span>
        </div>
        <section
          className="hotspot-login-card"
          aria-labelledby="hotspot-login-title"
        >
          <div className="hotspot-login-icon" aria-hidden="true">
            <LogIn />
          </div>
          <h1 id="hotspot-login-title">
            Masuk Ke PerumNet Monitoring NOC System
          </h1>
          <p>Monitoring NOC Management System</p>
          <Suspense fallback={<p className="text-sm text-muted-foreground">Memuat…</p>}>
            <LoginForm />
          </Suspense>
        </section>
        <p className="hotspot-login-footer">
          © 2026 PerumNet. All Rights Reserved.
        </p>
      </div>
    </main>
  );
}
