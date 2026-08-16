# Changes in this build

- Restored the app to the original Supabase Auth + database + Realtime implementation.
- Removed the temporary alternate-backend configuration and setup files.
- Added true Web Push subscription support through the existing service worker.
- Added a Supabase `push_subscriptions` table protected by per-user RLS.
- Added server-side reminder timestamps (`due_at`) so notifications do not depend on the app staying open.
- Added the `send-reminder-pushes` Supabase Edge Function.
- Added a one-minute Supabase Cron workflow for background reminder delivery.
- Added `notification_deliveries` deduplication so the same reminder is not repeatedly pushed.
- Added transient push retry handling and automatic disabling of expired push endpoints.
- Added a VAPID/cron-secret generator and a complete push setup guide.
- Pinned the Supabase JS client version used by this build.
