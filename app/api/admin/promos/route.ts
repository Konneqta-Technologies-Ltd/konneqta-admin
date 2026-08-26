import { hasPermission, requireAdminApi } from "@/lib/auth/guard";

import { NextResponse } from "next/server";
import { createPromo } from "@/lib/admin/promos";

/**
 * POST /api/admin/promos — create a promo code.
 * Body: { code: string, rewardDays: number, maxUses?: number|null,
 *         validUntil?: string|null, description?: string }
 */
export async function POST(request: Request) {
  const guard = await requireAdminApi();
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.error },
      { status: guard.status }
    );
  }
  if (!(await hasPermission(guard.session, "promos.manage"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    code?: unknown;
    rewardDays?: unknown;
    maxUses?: unknown;
    validUntil?: unknown;
    description?: unknown;
  } | null;

  const code = typeof body?.code === "string" ? body.code : "";
  if (!code.trim()) {
    return NextResponse.json(
      { error: "A promo code is required." },
      { status: 400 }
    );
  }

  const rewardDays =
    typeof body?.rewardDays === "number"
      ? body.rewardDays
      : Number(body?.rewardDays);
  if (!Number.isFinite(rewardDays)) {
    return NextResponse.json(
      { error: "A whole number of days is required." },
      { status: 400 }
    );
  }

  const maxUses =
    body?.maxUses === null || body?.maxUses === undefined || body?.maxUses === ""
      ? null
      : Number(body?.maxUses);

  const validUntil =
    typeof body?.validUntil === "string" && body.validUntil.trim()
      ? body.validUntil
      : null;

  const description =
    typeof body?.description === "string" ? body.description : null;

  const result = await createPromo({
    code,
    rewardDays,
    maxUses,
    validUntil,
    description,
    adminId: guard.session.admin!.id,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ success: true, promo: result.promo });
}
