import { hasPermission, requireAdmin } from "@/lib/auth/guard";

import { AUDIENCE_LABELS, BROADCAST_AUDIENCES, BROADCAST_MAX_RECIPIENTS } from "@/lib/admin/broadcast";
import { isWebPushConfigured } from "@/lib/admin/notify";
import { BroadcastForm } from "./broadcast-form";

/**
 * Broadcast page — push notifications to an audience of users, delivered to
 * every surface they registered (in-app + Web Push + Expo Push). Gated on
 * the notifications.send permission.
 */
export default async function AdminBroadcastPage() {
  const session = await requireAdmin();
  if (!(await hasPermission(session, "notifications.send"))) {
    return <AccessDenied />;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
        Communication
      </p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">Broadcast</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Send a push notification to users — it lands in the app&apos;s
        notification center (web bell + mobile feed) AND on every registered
        device (browsers via Web Push, iOS/Android via Expo Push). Users can
        opt out per notification type in their app Settings.
      </p>

      <div className="mt-6">
        <BroadcastForm
          audiences={BROADCAST_AUDIENCES.map((value) => ({
            value,
            label: AUDIENCE_LABELS[value],
          }))}
          webPushConfigured={isWebPushConfigured()}
        />
      </div>

      <p className="mt-4 text-xs text-zinc-600">
        Audiences resolve through the customer directory view (max{" "}
        {BROADCAST_MAX_RECIPIENTS.toLocaleString()} recipients per send —
        narrow the audience beyond that).
      </p>
    </div>
  );
}

function AccessDenied() {
  return (
    <div className="rounded-2xl border border-red-900/50 bg-red-950/30 p-6 text-sm text-red-200">
      You do not have permission to send notifications.
    </div>
  );
}