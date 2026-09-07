/*
  LIFE ADMIN - SUPABASE CONFIGURATION

  1. Create a Supabase project.
  2. Run supabase-schema.sql in the Supabase SQL Editor.
  3. Replace the two values below with your Project URL and PUBLISHABLE key.

  IMPORTANT:
  - A Supabase publishable key is intended for browser apps.
  - NEVER put a service_role / secret key in this file.
*/
window.LIFE_ADMIN_CONFIG = {
  SUPABASE_URL: "https://yrdkwxlrbzbsfhrezoqj.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_8qolCRMDP8L29HNDAb_S7g_8RhX_kc1",

  // Public VAPID key used by browsers to create Web Push subscriptions.
  // Generate this together with the private VAPID key using generate-vapid-keys.mjs.
  VAPID_PUBLIC_KEY: "YOUR-VAPID-PUBLIC-KEY"
};
