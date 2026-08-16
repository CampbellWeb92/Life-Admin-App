// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import webpush from "npm:web-push@3.6.7";

function getAdminKey() {
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys);
      if (parsed.default) return parsed.default;
    } catch (error) {
      console.error("Could not parse SUPABASE_SECRET_KEYS", error);
    }
  }

  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const expectedCronSecret = Deno.env.get("PUSH_CRON_SECRET") || "";
  const suppliedCronSecret = req.headers.get("x-cron-secret") || "";
  if (!expectedCronSecret || suppliedCronSecret !== expectedCronSecret) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const adminKey = getAdminKey();
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") || "";
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "";

  if (!supabaseUrl || !adminKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return jsonResponse({ error: "Missing required Edge Function secrets" }, 500);
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const supabaseAdmin = createClient(supabaseUrl, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date();
  // A five-minute look-back tolerates an occasional delayed cron invocation.
  // notification_deliveries prevents duplicates if the same reminder is found again.
  const windowStart = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  const windowEnd = new Date(now.getTime() + 15 * 1000).toISOString();

  const { data: reminders, error: reminderError } = await supabaseAdmin
    .from("reminders")
    .select("id,user_id,title,category,priority,due_at")
    .eq("completed", false)
    .not("due_at", "is", null)
    .gte("due_at", windowStart)
    .lte("due_at", windowEnd)
    .order("due_at", { ascending: true })
    .limit(500);

  if (reminderError) {
    console.error(reminderError);
    return jsonResponse({ error: reminderError.message }, 500);
  }

  if (!reminders?.length) return jsonResponse({ checked: 0, sent: 0, failed: 0 });

  const userIds = [...new Set(reminders.map((reminder) => reminder.user_id))];
  const { data: subscriptions, error: subscriptionError } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth")
    .in("user_id", userIds)
    .eq("enabled", true)
    .limit(2000);

  if (subscriptionError) {
    console.error(subscriptionError);
    return jsonResponse({ error: subscriptionError.message }, 500);
  }

  const subscriptionsByUser = new Map();
  for (const subscription of subscriptions || []) {
    const list = subscriptionsByUser.get(subscription.user_id) || [];
    list.push(subscription);
    subscriptionsByUser.set(subscription.user_id, list);
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const reminder of reminders) {
    const userSubscriptions = subscriptionsByUser.get(reminder.user_id) || [];

    for (const subscription of userSubscriptions) {
      const { error: reservationError } = await supabaseAdmin
        .from("notification_deliveries")
        .insert({
          subscription_id: subscription.id,
          reminder_id: reminder.id,
          scheduled_for: reminder.due_at,
          status: "sending",
        });

      if (reservationError?.code === "23505") {
        skipped += 1;
        continue;
      }

      if (reservationError) {
        console.error("Could not reserve notification delivery", reservationError);
        failed += 1;
        continue;
      }

      const pushSubscription = {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      };

      const payload = JSON.stringify({
        title: reminder.title || "Life Admin reminder",
        body: `Due now · ${reminder.category || "Reminder"}${reminder.priority === "high" ? " · High priority" : ""}`,
        icon: "icons/icon-192.png",
        badge: "icons/icon-192.png",
        tag: `reminder-${reminder.id}-${reminder.due_at}`,
        url: "./",
        reminderId: reminder.id,
        scheduledFor: reminder.due_at,
      });

      try {
        await webpush.sendNotification(pushSubscription, payload, {
          TTL: 60 * 60,
          urgency: reminder.priority === "high" ? "high" : "normal",
        });

        sent += 1;
        await supabaseAdmin
          .from("notification_deliveries")
          .update({ status: "sent", sent_at: new Date().toISOString(), error_text: null })
          .eq("subscription_id", subscription.id)
          .eq("reminder_id", reminder.id)
          .eq("scheduled_for", reminder.due_at);
      } catch (error) {
        failed += 1;
        const statusCode = Number(error?.statusCode || 0);
        const message = String(error?.body || error?.message || "Push delivery failed").slice(0, 1000);

        console.error("Push delivery failed", statusCode, message);

        if (statusCode === 404 || statusCode === 410) {
          await supabaseAdmin
            .from("notification_deliveries")
            .update({ status: "failed", error_text: message })
            .eq("subscription_id", subscription.id)
            .eq("reminder_id", reminder.id)
            .eq("scheduled_for", reminder.due_at);

          await supabaseAdmin
            .from("push_subscriptions")
            .update({ enabled: false, updated_at: new Date().toISOString() })
            .eq("id", subscription.id);
        } else {
          // Allow a transient push-provider/network failure to retry on the next cron run.
          await supabaseAdmin
            .from("notification_deliveries")
            .delete()
            .eq("subscription_id", subscription.id)
            .eq("reminder_id", reminder.id)
            .eq("scheduled_for", reminder.due_at);
        }
      }
    }
  }

  return jsonResponse({ checked: reminders.length, sent, failed, skipped });
});
