import { logger } from "@/lib/logger";

/**
 * ZeptoMail transactional email — the ADMIN app's minimal port of the
 * customer app's lib/emails/zeptomail.ts (same REST API, same key
 * convention). Used ONLY by the monthly digest (cron + "Send now").
 *
 * SECURITY
 * - ZEPTOMAIL_API_KEY is server-side only (no NEXT_PUBLIC_ prefix) and is
 *   used verbatim in the Authorization header (ZeptoMail keys carry their
 *   own "Zoho-enczapikey …" prefix).
 * - The "from" address must be a VERIFIED sender in ZeptoMail (the customer
 *   app sends from info@konneqta.com; override via REPORT_FROM_EMAIL).
 * - REPORT_RECIPIENT_EMAIL is where the digest lands (defaults to
 *   ADMIN_NOTIFICATION_EMAIL for parity with the customer app's admin alert).
 * - Failures are returned, never thrown — the caller decides whether the
 *   cron run should retry.
 *
 * API docs: https://www.zoho.com/zeptomail/help/api/email-sending.html
 */

const ZEPTOMAIL_API_URL = "https://api.zeptomail.com/v1.1/email";

export function getReportRecipient(): string | null {
  return (
    process.env.REPORT_RECIPIENT_EMAIL ||
    process.env.ADMIN_NOTIFICATION_EMAIL ||
    null
  );
}

export async function sendReportEmail(input: {
  subject: string;
  html: string;
  recipient?: string;
}): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.ZEPTOMAIL_API_KEY;
  if (!apiKey) {
    logger.warn(
      "email",
      "ZEPTOMAIL_API_KEY not set — skipping report email send"
    );
    return { success: false, error: "ZEPTOMAIL_API_KEY not configured" };
  }

  const toEmail = input.recipient || getReportRecipient();
  if (!toEmail || !toEmail.includes("@")) {
    logger.warn(
      "email",
      "No REPORT_RECIPIENT_EMAIL configured — skipping report email"
    );
    return { success: false, error: "Report recipient not configured" };
  }

  try {
    const response = await fetch(ZEPTOMAIL_API_URL, {
      method: "POST",
      headers: {
        // The key already includes its prefix — use it verbatim.
        Authorization: apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        from: {
          address: process.env.REPORT_FROM_EMAIL || "info@konneqta.com",
          name: "Konneqta Admin",
        },
        to: [
          {
            email_address: { address: toEmail, name: "Konneqta Team" },
          },
        ],
        subject: input.subject,
        htmlbody: input.html,
      }),
    });

    const data = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
    };

    if (!response.ok) {
      logger.error(
        "email",
        `ZeptoMail API error (${response.status}) sending report to ${toEmail}`,
        data?.error?.message
      );
      return {
        success: false,
        error: data?.error?.message || `HTTP ${response.status}`,
      };
    }

    return { success: true };
  } catch (err) {
    logger.error("email", "Network error sending report email", err);
    return { success: false, error: "Network error contacting ZeptoMail" };
  }
}