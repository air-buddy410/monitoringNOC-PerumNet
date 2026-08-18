import Link from "next/link";
import { ApiError } from "@/lib/api/http";

export default function ApiErrorNotice({
  error,
  fallback,
  className = "",
}: {
  error: unknown;
  fallback: string;
  className?: string;
}) {
  const message = error instanceof Error ? error.message : fallback;
  const unauthorized = error instanceof ApiError && error.status === 401;

  return (
    <div
      role="alert"
      className={`border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive ${className}`}
    >
      <p>{message || fallback}</p>
      {unauthorized && (
        <Link href="/login" className="mt-1 inline-block font-medium underline">
          Masuk kembali
        </Link>
      )}
    </div>
  );
}
