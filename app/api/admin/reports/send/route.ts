import { hasPermission, requireAdminApi } from "@/lib/auth/guard";

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import {
  fetchMonthlyReport,
  formatReportEmailHtml,
  formatReportText,
  parseMonthParam,
  previousMonthRange,
} from "@/lib/admin/monthly-report";
import { getReportRecipient, sendReportEmail } from "@/lib/admin/email";

/**
 * POST /api/admin/reports/send — the Reports page's "Send now" button.
 * Body: { month?: "YYYY-MM" } (default: previous calendar month).
 *
 * SUPER ADMIN ONLY (it emails platform internals). Deliberate re-send: the
 * period's idempotency row is deleted first, unlike the cron path which
 * refuses a second send. Audited as report.send.
 */
export const maxDuration = 60;

export async function POST(request: Request) {
  const guard = await requireAdminApi();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  if (!(await hasPermission(guard.session, "notifications.send"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (guard.session.admin!.role.name !== "super_admin") {
    return NextResponse.json(
      { error: "Only a Super Admin can send the monthly report." },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => null)) as {
    month?: unknown;
  } | null;
  const range =
    parseMonthParam(typeof body?.month === "string" ? body.month : null) ??
    previousMonthRange();

  const admin = createAdminClient();

  // Manual re-send: clear the idempotency row, then claim fresh.
  await admin
    .from("admin_report_logs")
    .delete()
    .eq("period_start", range.from)
    .eq("period_end", range.to);
  const { data: claimed, error: claimError } = await admin
    .from("admin_report_logs")
    .insert({
      period_start: range.from,
      period_end: range.to,
      triggered_by: guard.session.email,
    })
    .select("id")
    .maybeSingle();
  if (claimError || !claimed) {
    logger.error("reports", "report claim failed", claimError);
    return NextResponse.json(
      { error: "Could not claim the report period." },
      { status: 500 }
    );
  }

  let html: string;
  let text: string;
  let label: string;
  try {
    const report = await fetchMonthlyReport(range.from, range.to);
    label = report.label;
    html = formatReportEmailHtml(report);
    text = formatReportText(report);
  } catch (err) {
    logger.error("reports", "monthly report fetch failed", err);
    await admin.from("admin_report_logs").delete().eq("id", claimed.id);
    return NextResponse.json(
      {
        error:
          "admin_monthly_report failed — has supabase/admin-data-views.sql been re-run?",
      },
      { status: 502 }
    );
  }

  const recipient = getReportRecipient();
  const email = await sendReportEmail({
    subject: `Konneqta — ${label} report`,
    html,
  });

  await admin
    .from("admin_report_logs")
    .update({
      recipient,
      payload: { text, email_success: email.success, email_error: email.error ?? null },
    })
    .eq("id", claimed.id);

  try {
    await admin.from("admin_audit_logs").insert({
      admin_id: guard.session.admin!.id,
      action: "report.send",
      target_type: "report",
      target_id: range.from,
      metadata: {
        period_end: range.to,
        recipient,
        success: email.success,
        error: email.error ?? null,
      },
    });
  } catch (auditError) {
    logger.error("reports", "audit insert failed", auditError);
  }

  if (!email.success) {
    return NextResponse.json(
      { error: email.error ?? "Email send failed" },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true, period: range, recipient });
}