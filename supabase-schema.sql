-- LIFE ADMIN - SUPABASE DATABASE SETUP
-- Run this entire file in your Supabase SQL Editor.
-- It creates user-owned reminders, expenses and appearance settings with RLS.

create extension if not exists pgcrypto;

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  category text not null default 'Other',
  priority text not null default 'normal' check (priority in ('normal','high')),
  due_date date not null,
  due_time time default '09:00',
  due_at timestamptz,
  due_timezone text not null default 'UTC',
  repeat text not null default 'none' check (repeat in ('none','weekly','monthly','yearly')),
  amount numeric(12,2),
  notes text,
  completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  amount numeric(12,2) not null default 0,
  frequency text not null default 'monthly' check (frequency in ('weekly','monthly','yearly')),
  next_date date not null,
  created_at timestamptz not null default now()
);

alter table public.expenses add column if not exists category text not null default 'Other';
alter table public.expenses add column if not exists status text not null default 'unpaid' check (status in ('unpaid','paid'));
alter table public.expenses add column if not exists notes text;

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'light' check (theme in ('light','dark','soft','warm','system')),
  accent text not null default '#1f6f5f',
  accent_name text not null default 'Emerald',
  updated_at timestamptz not null default now()
);

-- Existing Life Admin projects can safely re-run this schema.
-- These ALTER statements add background-push scheduling fields to older reminder tables.
alter table public.reminders add column if not exists due_at timestamptz;
alter table public.reminders add column if not exists due_timezone text not null default 'UTC';
alter table public.reminders add column if not exists location text;
alter table public.reminders add column if not exists remind_before integer not null default 0;
alter table public.reminders add column if not exists attachment text;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  timezone text not null default 'UTC',
  user_agent text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  reminder_id uuid not null references public.reminders(id) on delete cascade,
  scheduled_for timestamptz not null,
  status text not null default 'sending' check (status in ('sending','sent','failed')),
  sent_at timestamptz,
  error_text text,
  created_at timestamptz not null default now(),
  unique (subscription_id, reminder_id, scheduled_for)
);

alter table public.reminders enable row level security;
alter table public.expenses enable row level security;
alter table public.user_settings enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_deliveries enable row level security;

-- Explicit grants for the browser client. RLS still controls which rows a signed-in user may access.
grant select, insert, update, delete on public.reminders to authenticated;
grant select, insert, update, delete on public.expenses to authenticated;
grant select, insert, update, delete on public.user_settings to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Delivery logs are backend-only; signed-in browsers cannot read or write them.
revoke all on public.notification_deliveries from anon, authenticated;

revoke all on public.reminders from anon;
revoke all on public.expenses from anon;
revoke all on public.user_settings from anon;
revoke all on public.push_subscriptions from anon;

drop policy if exists "Users can view their own reminders" on public.reminders;
drop policy if exists "Users can insert their own reminders" on public.reminders;
drop policy if exists "Users can update their own reminders" on public.reminders;
drop policy if exists "Users can delete their own reminders" on public.reminders;

create policy "Users can view their own reminders"
on public.reminders for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own reminders"
on public.reminders for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own reminders"
on public.reminders for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own reminders"
on public.reminders for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can view their own expenses" on public.expenses;
drop policy if exists "Users can insert their own expenses" on public.expenses;
drop policy if exists "Users can update their own expenses" on public.expenses;
drop policy if exists "Users can delete their own expenses" on public.expenses;

create policy "Users can view their own expenses"
on public.expenses for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own expenses"
on public.expenses for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own expenses"
on public.expenses for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own expenses"
on public.expenses for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can view their own settings" on public.user_settings;
drop policy if exists "Users can insert their own settings" on public.user_settings;
drop policy if exists "Users can update their own settings" on public.user_settings;
drop policy if exists "Users can delete their own settings" on public.user_settings;

create policy "Users can view their own settings"
on public.user_settings for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own settings"
on public.user_settings for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own settings"
on public.user_settings for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own settings"
on public.user_settings for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can view their own push subscriptions" on public.push_subscriptions;
drop policy if exists "Users can insert their own push subscriptions" on public.push_subscriptions;
drop policy if exists "Users can update their own push subscriptions" on public.push_subscriptions;
drop policy if exists "Users can delete their own push subscriptions" on public.push_subscriptions;

create policy "Users can view their own push subscriptions"
on public.push_subscriptions for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can insert their own push subscriptions"
on public.push_subscriptions for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own push subscriptions"
on public.push_subscriptions for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own push subscriptions"
on public.push_subscriptions for delete
to authenticated
using ((select auth.uid()) = user_id);

-- notification_deliveries intentionally has no browser policies.
-- The scheduled Edge Function writes it with a server-side Supabase secret key.

-- Enable Realtime for cross-device refreshes.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reminders'
  ) then
    alter publication supabase_realtime add table public.reminders;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'expenses'
  ) then
    alter publication supabase_realtime add table public.expenses;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_settings'
  ) then
    alter publication supabase_realtime add table public.user_settings;
  end if;
end $$;

create index if not exists reminders_user_due_idx
  on public.reminders (user_id, due_date);

create index if not exists expenses_user_next_idx
  on public.expenses (user_id, next_date);


create index if not exists reminders_due_push_idx
  on public.reminders (due_at)
  where completed = false and due_at is not null;

create index if not exists push_subscriptions_user_enabled_idx
  on public.push_subscriptions (user_id, enabled);

create index if not exists notification_deliveries_lookup_idx
  on public.notification_deliveries (reminder_id, scheduled_for);
