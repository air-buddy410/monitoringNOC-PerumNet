import type { TvSnapshot } from "@/types/tv";

export class TvSnapshotError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

function readErrorMessage(body: unknown, fallback: string) {
  if (typeof body === "object" && body !== null) {
    const error = "error" in body ? body.error : undefined;
    const message = "message" in body ? body.message : undefined;
    if (typeof error === "string") return error;
    if (typeof message === "string") return message;
  }
  return fallback;
}

async function readResponse<T>(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new TvSnapshotError(
      readErrorMessage(body, fallback),
      response.status,
    );
  }
  return body as T;
}

/** Reads the one-use token from the URL fragment without ever serializing it. */
export function readTvTokenFromHash(hash: string) {
  if (!hash.startsWith("#")) return null;
  const token = new URLSearchParams(hash.slice(1)).get("token")?.trim();
  return token || null;
}

async function fetchSnapshot(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  return readResponse<TvSnapshot>(response, "Snapshot wallboard tidak dapat dimuat.");
}

/**
 * Snapshot dicoba lebih dulu supaya TV yang masih memiliki cookie bisa hidup
 * kembali setelah restart tanpa meminta token lagi. Fragmen baru dibaca hanya
 * setelah server menjawab 401, lalu URL dibersihkan setelah penukaran sukses.
 */
export async function fetchTvSnapshot(
  url = "/api/v1/tv/snapshot",
): Promise<TvSnapshot> {
  const first = await fetch(url, { cache: "no-store" });
  if (first.ok) {
    return readResponse<TvSnapshot>(first, "Snapshot wallboard tidak dapat dimuat.");
  }
  const firstBody = await first.json().catch(() => null);
  if (first.status !== 401) {
    throw new TvSnapshotError(
      readErrorMessage(firstBody, "Snapshot wallboard tidak dapat dimuat."),
      first.status,
    );
  }

  const token = readTvTokenFromHash(window.location.hash);
  if (!token) {
    throw new TvSnapshotError(
      "Layar TV belum tersambung. Buka URL token dari admin NOC.",
      401,
    );
  }

  const sessionResponse = await fetch("/api/v1/tv/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  await readResponse<{ ok: true; name: string }>(
    sessionResponse,
    "Tautan layar TV tidak berlaku.",
  );

  window.history.replaceState(null, "", "/tv");
  return fetchSnapshot(url);
}
