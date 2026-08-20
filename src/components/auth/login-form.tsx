"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthMode } from "@/hooks/use-auth-mode";
import { ApiError, sendJson } from "@/lib/api/http";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: authMode } = useAuthMode();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const mailserverLogin = authMode?.provider === "MAILSERVER";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await sendJson("POST", "/api/auth/sign-in/portal", { email, password });
      const callbackUrl = searchParams.get("callbackUrl");
      router.push(callbackUrl ?? "/dashboard");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError(err.message || "Email atau password salah.");
        } else if (err.status === 503) {
          setError(err.message || "Mailserver tidak tersedia.");
        } else if (err.status === 429) {
          setError(err.message || "Terlalu banyak percobaan. Tunggu sebentar sebelum mencoba lagi.");
        } else {
          setError(err.message);
        }
      } else {
        setError(err instanceof Error ? err.message : "Gagal masuk.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    // Boolean() => render nothing during SSR (Suspense boundary needed)
    // login page wraps LoginForm in <Suspense> — useSearchParams requires it.
    <form
      onSubmit={handleSubmit}
      className="hotspot-login-form flex flex-col"
    >
      <div className="space-y-1.5">
        <Label htmlFor="email">Username atau Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          placeholder="nama@email.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="Masukkan password"
          aria-describedby={mailserverLogin ? "login-password-hint" : undefined}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {mailserverLogin && (
          <p
            id="login-password-hint"
            className="text-xs leading-5 text-muted-foreground"
          >
            Gunakan password email (mailcow) untuk masuk ke portal.
          </p>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      <Button type="submit" disabled={loading} className="mt-1">
        {loading ? "Memeriksa…" : "Masuk"}
      </Button>
    </form>
  );
}
