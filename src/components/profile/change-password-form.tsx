"use client";

import { useState } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthMode } from "@/hooks/use-auth-mode";
import { ApiError, sendJson } from "@/lib/api/http";

export default function ChangePasswordForm() {
  const { data: authMode, error: authModeError, isLoading: authModeLoading } = useAuthMode();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaved(false);
    // Verifikasi lokal — aturan dasar kekuatan & konsistensi kata sandi.
    if (next.length < 8) {
      setError("Kata sandi baru minimal 8 karakter.");
      return;
    }
    if (!/[0-9]/.test(next) || !/[a-zA-Z]/.test(next)) {
      setError("Kata sandi baru harus mengandung huruf dan angka.");
      return;
    }
    if (next === current) {
      setError("Kata sandi baru tidak boleh sama dengan kata sandi lama.");
      return;
    }
    if (next !== confirm) {
      setError("Konfirmasi kata sandi tidak sama.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await sendJson("POST", "/api/auth/change-password", {
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: false,
      });
      setSaved(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Masuk dulu untuk mengubah kata sandi.");
      } else if (
        err instanceof Error &&
        err.message.toLowerCase().includes("invalid password")
      ) {
        setError("Kata sandi lama salah.");
      } else {
        setError(
          err instanceof Error ? err.message : "Gagal mengubah kata sandi.",
        );
      }
    } finally {
      setSaving(false);
    }
  }

  if (authModeLoading) {
    return (
      <section
        className="flex h-full flex-col rounded-lg border bg-card"
        aria-busy="true"
      >
        <div className="border-b px-4 py-3">
          <p className="text-sm font-medium">Keamanan — Ubah Kata Sandi</p>
        </div>
        <p className="px-4 py-6 text-sm text-muted-foreground">
          Memeriksa aturan keamanan akun…
        </p>
      </section>
    );
  }

  if (authModeError || !authMode) {
    return (
      <section
        className="flex h-full flex-col rounded-lg border border-destructive/30 bg-card"
        role="alert"
      >
        <div className="border-b px-4 py-3">
          <p className="text-sm font-medium">Keamanan — Ubah Kata Sandi</p>
        </div>
        <p className="px-4 py-6 text-sm text-destructive">
          {authModeError instanceof Error
            ? authModeError.message
            : "Mode login belum dapat dibaca. Form password ditahan demi keamanan."}
        </p>
      </section>
    );
  }

  if (!authMode.passwordChangeAvailable) {
    return (
      <section className="flex h-full flex-col rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-medium">Keamanan — Ubah Kata Sandi</p>
        </div>
        <div className="flex flex-1 flex-col justify-center gap-2 px-4 py-6">
          <p className="text-sm font-medium">Password dikelola melalui webmail</p>
          <p className="text-xs leading-5 text-muted-foreground">
            Mode {authMode.provider} tidak memiliki password portal terpisah.
            Perubahan password dilakukan melalui webmail, bukan dari halaman ini.
          </p>
        </div>
      </section>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex h-full flex-col rounded-lg border bg-card"
    >
      <div className="border-b px-4 py-3">
        <p className="text-sm font-medium">Keamanan — Ubah Kata Sandi</p>
      </div>
      <div className="flex flex-1 flex-col gap-4 px-4 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="current-password">Kata Sandi Lama</Label>
          <Input
            id="current-password"
            type="password"
            required
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-password">Kata Sandi Baru</Label>
          <Input
            id="new-password"
            type="password"
            required
            placeholder="Min. 8 karakter, huruf & angka"
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-password">Konfirmasi Kata Sandi Baru</Label>
          <Input
            id="confirm-password"
            type="password"
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </div>

        {error && (
          <p className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        {saved && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-[#0ca30c]">
            <CircleCheck className="size-3.5" aria-hidden />
            Kata sandi berhasil diubah.
          </p>
        )}

        <div className="mt-auto">
          <Button type="submit" disabled={saving}>
            {saving ? "Menyimpan…" : "Ubah Kata Sandi"}
          </Button>
        </div>
      </div>
    </form>
  );
}
