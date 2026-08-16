# Life Admin — Supabase Background Push Setup

This build uses standards-based Web Push plus a Supabase Edge Function. The phone/browser does **not** need to keep Life Admin open for the server-side push to be sent.

## 1. Run the updated database schema

In Supabase **SQL Editor**, run the full contents of:

`supabase-schema.sql`

It is safe to run on an older Life Admin database. It adds:

- `reminders.due_at`
- `reminders.due_timezone`
- `push_subscriptions`
- `notification_deliveries`
- RLS policies and explicit authenticated grants

## 2. Generate Web Push keys

On a computer with Node.js installed, run from the Life Admin folder:

```bash
node generate-vapid-keys.mjs
```

It prints three values:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `PUSH_CRON_SECRET`

Keep the **private key** and **cron secret** private.

## 3. Add the public keys to `config.js`

Set your normal Supabase browser configuration and paste only the VAPID public key into the browser config:

```js
window.LIFE_ADMIN_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "YOUR-PUBLISHABLE-KEY",
  VAPID_PUBLIC_KEY: "PASTE-VAPID-PUBLIC-KEY-HERE"
};
```

Never put the VAPID private key, Supabase secret key, or cron secret in `config.js`.

## 4. Deploy the Edge Function

The function is already included at:

`supabase/functions/send-reminder-pushes/index.ts`

Deploy it with the current Supabase CLI:

```bash
supabase functions deploy send-reminder-pushes
```

`supabase/config.toml` already sets `verify_jwt = false` for this cron-only function. The function itself requires the separate `x-cron-secret` header.

## 5. Add Edge Function secrets

In Supabase **Edge Functions → Secrets**, add:

```text
VAPID_PUBLIC_KEY=the_public_key_from_step_2
VAPID_PRIVATE_KEY=the_private_key_from_step_2
VAPID_SUBJECT=mailto:you@example.com
PUSH_CRON_SECRET=the_cron_secret_from_step_2
```

Use an email address you control for `VAPID_SUBJECT`.

Supabase supplies the project URL and server-side Supabase secret-key environment variables to hosted Edge Functions automatically. Do not copy a Supabase secret key into the website.

## 6. Schedule the function every minute

In Supabase, enable the `pg_cron` and `pg_net` extensions if they are not already enabled.

Store the function URL and the same cron secret in **Vault**. Replace the example values first:

```sql
select vault.create_secret(
  'https://YOUR-PROJECT.supabase.co',
  'life_admin_project_url'
);

select vault.create_secret(
  'PASTE-THE-SAME-PUSH-CRON-SECRET-HERE',
  'life_admin_push_cron_secret'
);
```

Then schedule the Edge Function once per minute:

```sql
select cron.schedule(
  'life-admin-reminder-pushes',
  '* * * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'life_admin_project_url'
    ) || '/functions/v1/send-reminder-pushes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'life_admin_push_cron_secret'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
```

To see the job later:

```sql
select * from cron.job where jobname = 'life-admin-reminder-pushes';
```

## 7. Upload the website and enable notifications

The website must be served over HTTPS in production.

1. Sign in to Life Admin.
2. Press **Notifications**.
3. Allow notifications when the browser asks.
4. Create a reminder a few minutes in the future.
5. Close the app / lock the phone and wait for the reminder time.

### iPhone / iPad

Install Life Admin to the Home Screen first. Open the installed Home Screen app and press **Notifications** there.

### Android / desktop

Compatible browsers can receive Web Push after permission is granted. Installing the PWA is still recommended for the best app-like experience.

## Security notes

- Supabase publishable key: browser-safe when RLS is correctly configured.
- Supabase secret key: backend only.
- VAPID public key: browser-safe.
- VAPID private key: Edge Function secret only.
- `PUSH_CRON_SECRET`: Edge Function + Vault only.
- `notification_deliveries` has no browser RLS policies and is used only by the server to prevent duplicate notifications.
