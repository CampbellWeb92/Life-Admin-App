# Life Admin — Supabase + Installable PWA

This build includes:

- Email/password sign-up and login with Supabase Auth
- Persistent login sessions
- Password reset flow
- Per-user cloud syncing
- Secure Row Level Security (RLS)
- Realtime refresh across signed-in devices
- Reminders synced to Supabase
- Recurring expenses synced to Supabase
- Theme and app-colour preferences synced to Supabase
- Local browser cache for resilience
- Offline change queue that uploads pending changes before the next cloud refresh
- Legacy local-data migration on first cloud login
- Sync status and manual “Sync now”
- Sign out / account panel
- Install App button
- Android/Desktop PWA install prompt
- iPhone/iPad “Add to Home Screen” instructions
- PWA icons and offline shell caching

## 1. Create a Supabase project

Create a project in Supabase.

## 2. Set up the database

Open the Supabase **SQL Editor**.

Copy the entire contents of:

`supabase-schema.sql`

Paste it into the SQL Editor and run it.

This creates:

- `reminders`
- `expenses`
- `user_settings`

It also enables Row Level Security so each signed-in user can only access rows where `user_id` matches their own Supabase user ID.

## 3. Add your Supabase credentials

Open:

`config.js`

Replace:

`https://YOUR-PROJECT.supabase.co`

with your Supabase Project URL.

Replace:

`YOUR-PUBLISHABLE-KEY`

with your Supabase **publishable key**.

### Security warning

Use a browser-safe **publishable** key only.

NEVER put a `service_role`, secret key, database password, or other server secret inside `config.js`.

## 4. Configure Supabase Auth

In Supabase:

**Authentication → Providers → Email**

Make sure Email is enabled.

If email confirmation is enabled, add your final website URL to your Supabase Auth URL configuration / redirect URLs.

Example:

`https://yourdomain.co.za/life-admin/`

Password-reset links also return to this website.

## 5. Upload it to your website

Upload the full `life-admin-app` folder to your website.

For example:

`public_html/life-admin/`

The app could then be available at:

`https://yourdomain.co.za/life-admin/`

PWA installation requires HTTPS in normal production use.

## 6. Install from the website

Open the hosted Life Admin website.

Press:

**Install App**

On compatible Android/Chrome/Edge browsers, the browser installation prompt opens.

On iPhone/iPad:

1. Open the website in Safari.
2. Tap **Share**.
3. Tap **Add to Home Screen**.

The app then appears on the home screen and opens in its own app-style window.

## Local testing

A service worker cannot provide the full install experience when opening `index.html` directly.

Use a local web server.

Example with Python:

`python -m http.server 8080`

Then open:

`http://localhost:8080`

## Important note about “downloadable”

This version is a **Progressive Web App (PWA)**. It installs directly from the website and does not require an APK or Play Store listing.

If you later want a real Android `.apk` / `.aab` or an iOS App Store package, this PWA can be wrapped using a mobile packaging tool such as Capacitor.


## Branding update

- Custom uploaded logo added to the app interface
- Custom uploaded image now used for all PWA app icons
