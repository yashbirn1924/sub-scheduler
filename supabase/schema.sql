-- Sub Scheduler — Stage 1 schema (durable state + auth gate)
-- ---------------------------------------------------------------------------
-- HOW TO APPLY
--   1. Supabase dashboard → SQL Editor → New query → paste this whole file → Run.
--   2. Create the single admin user:
--        Dashboard → Authentication → Users → Add user → "Create new user"
--        - Email: the admin address you want to log in with
--        - Password: set one
--        - Tick "Auto Confirm User" (so no email confirmation is needed)
--   3. That's it — the app's login screen uses that email + password.
--
-- WHAT THIS DOES
--   Stores the app's entire serialized state as one JSON document per
--   "deployment" (sample vs. real never collide — mirrors the old LS_KEY scheme).
--   Row-Level Security ensures only a signed-in user can read or write it;
--   the anonymous (logged-out) role gets nothing.
-- ---------------------------------------------------------------------------

create table if not exists public.app_state (
  deployment  text primary key,            -- deployment scope key (e.g. the data file path)
  data        jsonb        not null,        -- the persist() snapshot
  updated_at  timestamptz  not null default now(),
  updated_by  uuid         references auth.users(id) on delete set null
);

-- Enable Row-Level Security. With RLS on and no permissive policy, access is
-- denied by default — so the anon role can't touch this table at all.
alter table public.app_state enable row level security;

-- Table privileges for the API roles (RLS still gates every row).
grant select, insert, update on table public.app_state to authenticated;

-- Any authenticated (logged-in) user may read/write. This is a single-admin
-- app; later stages can scope these to specific user ids or an admins table.
drop policy if exists "app_state read for authenticated"   on public.app_state;
drop policy if exists "app_state insert for authenticated" on public.app_state;
drop policy if exists "app_state update for authenticated" on public.app_state;

create policy "app_state read for authenticated"
  on public.app_state for select
  to authenticated
  using (true);

create policy "app_state insert for authenticated"
  on public.app_state for insert
  to authenticated
  with check (true);

create policy "app_state update for authenticated"
  on public.app_state for update
  to authenticated
  using (true)
  with check (true);
