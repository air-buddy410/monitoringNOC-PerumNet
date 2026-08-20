"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthMode } from "@/hooks/use-auth-mode";
import { useSession } from "@/hooks/use-session";
import { sendJson } from "@/lib/api/http";
import { ROLE_LABELS } from "@/types/user";

export default function ProfileForm() {
  const { session, isLoading, mutate } = useSession();
  const {
    data: authMode,
    error: authModeError,
    isLoading: authModeLoading,
  } = useAuthMode();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saved, setSaved] = useState(false);
  const [savedMessage, setSavedMessage] = useState("Profil tersimpan");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailChangeAvailable = authMode?.emailChangeAvailable === true;

  // Prefill sekali per sesi login (pola "adjust state during render").
  const [initializedFor, setInitializedFor] = useState<string | null>(null);
  if (session && initializedFor !== session.user.id) {
    setInitializedFor(session.user.id);
    setName(session.user.name);
    setEmail(session.user.email);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!session) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    const emailChanged =
      emailChangeAvailable && email.trim().toLowerCase() !== session.user.email;
    try {
      if (name.trim() !== session.user.name) {
        await sendJson("POST", "/api/auth/update-user", { name: name.trim() });
      }
      if (emailChanged) {
        await sendJson("PATCH", "/api/profile/email", { email: email.trim() });
      }
      await mutate();
      setSavedMessage(
        emailChanged
          ? "Profil tersimpan. Email baru perlu diverifikasi ulang."
          : "Profil tersimpan",
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan profil.");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-full min-h-56 items-center justify-center rounded-lg border bg-card text-sm text-muted-foreground">
        Memuat profil…
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex h-full min-h-56 items-center justify-center rounded-lg border bg-card text-sm text-muted-foreground">
        <p>
          <Link href="/login" className="text-foreground hover:underline">
            Masuk
          </Link>{" "}
          untuk mengelola profil.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex h-full flex-col rounded-lg border bg-card"
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <p className="text-sm font-medium">Data Profil</p>
        <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium">
          {ROLE_LABELS[session.user.role]}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-4 px-4 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="profile-name">Nama Lengkap</Label>
          <Input
            id="profile-name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        {authModeLoading ? (
          <p className="text-xs leading-5 text-muted-foreground" aria-busy="true">
            Memeriksa aturan perubahan email…
          </p>
        ) : authModeError || !authMode ? (
          <p className="text-xs leading-5 text-destructive" role="alert">
            Mode login belum dapat dibaca. Isian email ditahan demi keamanan.
          </p>
        ) : emailChangeAvailable ? (
          <div className="space-y-1.5">
            <Label htmlFor="profile-email">Email</Label>
            <Input
              id="profile-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            {email.trim().toLowerCase() !== session.user.email && (
              <p className="text-xs leading-5 text-muted-foreground">
                Mengganti email akan mereset status verifikasi. Email baru perlu
                diverifikasi ulang.
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs leading-5 text-muted-foreground">
            Alamat email adalah identitas login dan tidak dapat diganti dari
            portal pada mode {authMode.provider}.
          </p>
        )}

        {error && <p className="text-xs text-[#d03b3b]">{error}</p>}

        <div className="mt-auto flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan Perubahan"}
          </Button>
          {saved && (
            <span className="flex items-center gap-1 text-xs font-medium text-[#0ca30c]">
              <CircleCheck className="size-3.5" aria-hidden />
              {savedMessage}
            </span>
          )}
        </div>
      </div>
    </form>
  );
}
