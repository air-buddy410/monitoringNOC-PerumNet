// RBAC (Fase 4): requireRole — 401 tanpa sesi, 403 peran tidak diizinkan,
// ok bila sesi cocok. `auth.api.getSession` di-mock penuh; tidak menyentuh
// DB maupun Better Auth nyata.

import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());

vi.mock("@/server/auth", () => ({
  auth: { api: { getSession } },
}));

import { requireRole } from "@/server/rbac";

function makeRequest() {
  return new Request("http://localhost/api/v1/incidents");
}

beforeEach(() => {
  getSession.mockReset();
});

describe("requireRole", () => {
  it("tanpa sesi → 401", async () => {
    getSession.mockResolvedValue(null);
    const result = await requireRole(makeRequest());
    expect(result).toEqual({ ok: false, status: 401, error: "Belum login." });
  });

  it("role tidak termasuk daftar izin → 403", async () => {
    getSession.mockResolvedValue({
      user: { id: "u1", name: "NOC", email: "noc@perumnet.id", role: "engineer" },
    });
    const result = await requireRole(makeRequest(), ["admin"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
  });

  it("role diizinkan → sesi diteruskan", async () => {
    getSession.mockResolvedValue({
      user: { id: "u1", name: "NOC", email: "noc@perumnet.id", role: "noc" },
    });
    const result = await requireRole(makeRequest(), ["admin", "noc"]);
    expect(result).toEqual({
      ok: true,
      user: { id: "u1", name: "NOC", email: "noc@perumnet.id", role: "noc" },
    });
  });

  it("daftar izin kosong = cukup login (peran apa pun)", async () => {
    getSession.mockResolvedValue({
      user: { id: "u2", name: "Mgr", email: "mgr@perumnet.id", role: "manajemen" },
    });
    const result = await requireRole(makeRequest());
    expect(result.ok).toBe(true);
  });

  it("user tanpa kolom role dianggap engineer", async () => {
    getSession.mockResolvedValue({ user: { id: "u3", name: "X", email: "x@perumnet.id" } });
    const result = await requireRole(makeRequest(), ["engineer"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.role).toBe("engineer");
  });
});
