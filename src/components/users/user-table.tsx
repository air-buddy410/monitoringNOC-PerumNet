"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { CircleCheck, CircleDashed, UserPlus, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/use-session";
import { ApiError, getJson, sendJson } from "@/lib/api/http";
import { ROLE_LABELS, type UserRole } from "@/types/user";

const ROLES = Object.keys(ROLE_LABELS) as UserRole[];

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: UserRole | null;
  emailVerified: boolean;
  createdAt: string;
}

interface UsersResponse {
  users: UserRow[];
  total: number;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function UserTable() {
  const { session } = useSession();
  const isAdmin = session?.user.role === "admin";
  const { data, error, mutate } = useSWR("/api/users", getJson<UsersResponse>, {
    revalidateOnFocus: false,
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "engineer" as UserRole });
  const [saving, setSaving] = useState(false);

  async function changeRole(userId: string, role: UserRole) {
    setActionError(null);
    try {
      await sendJson("PATCH", `/api/users/${userId}`, { role });
      await mutate();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Gagal mengubah peran.",
      );
      await mutate();
    }
  }

  async function createUser(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setActionError(null);
    try {
      await sendJson("POST", "/api/users", {
        name: form.name,
        email: form.email,
        password: form.password,
        role: form.role,
      });
      setForm({ name: "", email: "", password: "", role: "engineer" });
      setFormOpen(false);
      await mutate();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Gagal membuat pengguna.",
      );
    } finally {
      setSaving(false);
    }
  }

  const users = data?.users ?? [];

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <p className="text-sm font-medium">Daftar Pengguna</p>
        <div className="flex items-center gap-3">
          {actionError && (
            <p className="text-xs text-[#d03b3b]">{actionError}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {data ? `${data.total} pengguna` : "…"}
          </p>
          {isAdmin && (
            <Button
              type="button"
              size="sm"
              variant={formOpen ? "secondary" : "default"}
              onClick={() => setFormOpen((value) => !value)}
            >
              {formOpen ? (
                <X className="size-3.5" aria-hidden="true" />
              ) : (
                <UserPlus className="size-3.5" aria-hidden="true" />
              )}
              <span>{formOpen ? "Batal" : "Tambah Pengguna"}</span>
            </Button>
          )}
        </div>
      </div>

      {isAdmin && formOpen && (
        <form onSubmit={createUser} className="grid gap-3 border-b bg-muted/30 px-4 py-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1.5">
            <Label htmlFor="new-user-name">Nama Lengkap</Label>
            <Input
              id="new-user-name"
              required
              maxLength={80}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-user-email">Email</Label>
            <Input
              id="new-user-email"
              type="email"
              required
              autoComplete="off"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-user-password">Password (min. 8)</Label>
            <Input
              id="new-user-password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-user-role">Peran</Label>
            <Select
              value={form.role}
              onValueChange={(value) => setForm({ ...form, role: (value ?? "engineer") as UserRole })}
            >
              <SelectTrigger id="new-user-role" className="h-8 w-full bg-background text-xs">
                <SelectValue>{ROLE_LABELS[form.role]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((item) => (
                  <SelectItem key={item} value={item}>
                    {ROLE_LABELS[item]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? "Menyimpan…" : "Buat Akun"}
            </Button>
          </div>
        </form>
      )}

      {error instanceof ApiError ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          {error.status === 401 ? (
            <>
              <Link href="/login" className="text-foreground hover:underline">
                Masuk
              </Link>{" "}
              sebagai Admin NOC untuk mengelola pengguna.
            </>
          ) : (
            error.message
          )}
        </p>
      ) : !data ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          Memuat pengguna…
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Nama</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Peran</TableHead>
              <TableHead>Terdaftar</TableHead>
              <TableHead className="text-right">Status Email</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((row) => {
              const role = (row.role ?? "engineer") as UserRole;
              return (
                <TableRow key={row.id}>
                  <TableCell className="text-xs font-medium">
                    {row.name}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.email}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={role}
                      onValueChange={(value) =>
                        changeRole(row.id, (value ?? role) as UserRole)
                      }
                    >
                      <SelectTrigger
                        size="sm"
                        className="h-7 w-36 border bg-background text-xs"
                        aria-label={`Ubah peran ${row.name}`}
                      >
                        <SelectValue>{ROLE_LABELS[role]}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((item) => (
                          <SelectItem key={item} value={item}>
                            {ROLE_LABELS[item]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(row.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.emailVerified ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-[#0ca30c]">
                        <CircleCheck className="size-3.5" aria-hidden />
                        Terverifikasi
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-[#fab219]">
                        <CircleDashed className="size-3.5" aria-hidden />
                        Belum verifikasi
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
