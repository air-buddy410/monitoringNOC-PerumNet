import { NextResponse } from "next/server";
import type {
  ReviewSuggestionRequest,
  ReviewSuggestionResponse,
} from "@/server/api-v1/contracts";
import { withRole } from "@/server/rbac";
import { reviewSuggestion } from "@/server/topology-store";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/topologies/:topologyId/discovery/:suggestionId/review
 * Terima/tolak usulan discovery. Accepted langsung digabungkan ke topologi;
 * rejected hanya menutup usulan. Khusus admin/engineer.
 */
export const POST = withRole<{
  params: Promise<{ topologyId: string; suggestionId: string }>;
}>(
  ["admin", "engineer"],
  async (request, user, { params }) => {
    const { topologyId, suggestionId } = await params;

    let raw: ReviewSuggestionRequest;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Body harus JSON yang valid." },
        { status: 400 },
      );
    }

    if (raw.state !== "accepted" && raw.state !== "rejected") {
      return NextResponse.json(
        { error: "state wajib 'accepted' atau 'rejected'." },
        { status: 400 },
      );
    }

    const result = await reviewSuggestion({
      topologyId,
      suggestionId,
      state: raw.state,
      userId: user.id,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    const body: ReviewSuggestionResponse = { suggestion: result.suggestion };
    return NextResponse.json(body);
  },
);
