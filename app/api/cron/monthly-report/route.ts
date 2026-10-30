import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import {
  fetchMonthlyReport,
  formatReportEmailHtml,
  formatReportText,
  previousMonthRange,
} from "@/lib/admin/monthly-report";
import { getReportRecipient, sendReportEmail } from "@/lib/admin/email";

/**
 * GET /api/cron/monthly-report — Vercel Cron (daily 06:00 UTC, see
 * vercel.json). Sends the PREVIOUS month's digest, but only within the
 * first 3 days of a new month (a missed run retries the next day), and only
 * ONCE per period: the unique (period_start, period_end) index on
 * admin_report_logs makes double-sends impossible even across concurrent
 * retries.
 *
 * Auth: Authorization: Bearer $CRON_SECRET — Vercel injects this header
 * automatically when the CRON_SECRET env var is set on the project.
 */
export const maxDuration = 60;

function bearerOk(header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    logger.error("cron", "CRON_SECRET not configured — refusing to run");
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  if (!bearerOk(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Send only in the first 3 days of the month (retry window for missed runs).
  const day = new Date().getUTCDate();
  if (day > 3) {
    return NextResponse.json({ ok: true, skipped: "outside_send_window", day });
  }

  const range = previousMonthRange();
  const admin = createAdminClient();

  // Claim the period — 0 rows inserted means it was already sent (or claimed
  // by a concurrent run that is sending right now).
  const { data: claimed, error: claimError } = await admin
    .from("admin_report_logs")
    .upsert(
      { period_start: range.from, period_end: range.to, triggered_by: "cron" },
      { onConflict: "period_start,period_end", ignoreDuplicates: true }
    )
    .select("id")
    .maybeSingle();
  if (claimError) {
    logger.error("cron", "report claim failed", claimError);
    return NextResponse.json(
      { ok: false, error: "Could not claim the report period." },
      { status: 500 }
    );
  }
  if (!claimed) {
    return NextResponse.json({ ok: true, skipped: "already_sent", period: range });
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
    logger.error("cron", "monthly report fetch failed", err);
    // Release the claim so the next day's run can retry.
    await admin.from("admin_report_logs").delete().eq("id", claimed.id);
    return NextResponse.json(
      {
        ok: false,
        error: "admin_monthly_report failed",
        hint: "Run supabase/admin-data-views.sql (the RPC may not be deployed yet).",
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
      recipient: recipient,
      payload: { text, email_success: email.success, email_error: email.error ?? null },
    })
    .eq("id", claimed.id);

  if (!email.success) {
    // Keep the claim row: the email provider may be down for hours, and a
    // half-sent digest is worse than checking the admin Reports page. The
    // manual "Send now" (super admin) can always re-send after a fix.
    logger.error("cron", "report email failed", email.error);
    return NextResponse.json(
      { ok: false, error: email.error ?? "Email send failed" },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, period: range, recipient });
}