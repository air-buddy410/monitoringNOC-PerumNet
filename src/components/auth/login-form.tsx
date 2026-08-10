"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, sendJson } from "@/lib/api/http";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await sendJson("POST", "/api/auth/sign-in/email", { email, password });
      const callbackUrl = searchParams.get("callbackUrl");
      router.push(callbackUrl ?? "/dashboard");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "Email atau kata sandi salah. Periksa kembali kredensial Anda."
          : err instanceof Error
            ? err.message
            : "Gagal masuk.",
      );
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
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
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
