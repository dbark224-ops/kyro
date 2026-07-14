import { processDueCalendarSmsNotifications } from "../../../../../lib/notifications/calendar-sms";
import {
  envSecrets,
  hasAnyValidRequestSecret,
} from "../../../../../lib/http/request-secret";
import { createServiceSupabaseClient } from "../../../../../lib/supabase/service";

export const dynamic = "force-dynamic";

function notificationSecret() {
  return envSecrets(
    "CALENDAR_NOTIFICATION_SECRET",
    "OUTBOUND_DELIVERY_SECRET",
    "CRON_SECRET",
  );
}

async function runCalendarNotificationProcessor(request: Request) {
  const expectedSecrets = notificationSecret();

  if (expectedSecrets.length === 0) {
    return Response.json(
      {
        error:
          "CALENDAR_NOTIFICATION_SECRET, OUTBOUND_DELIVERY_SECRET, or CRON_SECRET is not configured.",
      },
      { status: 501 },
    );
  }

  if (!hasAnyValidRequestSecret(request, expectedSecrets)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "200");
  const workspaceId = url.searchParams.get("workspaceId");
  const supabase = createServiceSupabaseClient();
  const result = await processDueCalendarSmsNotifications(supabase, {
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : 200,
    workspaceId,
  });

  return Response.json(result);
}

export async function GET(request: Request) {
  return runCalendarNotificationProcessor(request);
}

export async function POST(request: Request) {
  return runCalendarNotificationProcessor(request);
}
