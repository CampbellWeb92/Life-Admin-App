# Life Admin — Complete Functional Build

This package contains the complete public Life Admin PWA.

Included:
- Supabase-connected reminders and expenses
- PWA/service worker
- Background Web Push support
- Per-reminder notification images
- Notification tone preference/preview
- Custom app background image support
- Offline/realtime functionality
- VAPID public key configured

Security:
- No VAPID private key, service-role key, or push cron secret is included.
- Background push secrets remain in the Supabase Edge Function.

Per-reminder notification images:
- Select an image inside Set Reminder.
- Each reminder can have a different image.
- Images are stored privately in Supabase Storage.
