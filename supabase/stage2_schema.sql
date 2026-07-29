-- Sub Scheduler — Stage 2 schema (normalized tables)
-- ---------------------------------------------------------------------------
-- Replaces the single app_state JSON blob (Stage 1) with real tables so the
-- data is queryable ("who's absent Tue?", "who's free 10:15-11:00?") and safe
-- to build on for Google Calendar (Stage 3) and self-report (v1.1).
--
-- HOW TO APPLY
--   Supabase dashboard -> SQL Editor -> New query -> paste this file -> Run.
--   This only CREATES the tables. Populating them from your current app_state
--   blob is a separate one-time migration (see the migration script) so we can
--   back up and verify first. The Stage 1 app_state table is left untouched as
--   a rollback until the migration is confirmed.
--
-- NOTES ON MODELING
--   * Ids stay TEXT and reuse the app's existing ids (e.g. "Naoko0",
--     set "primary") so references line up 1:1 with the current data and the
--     app code doesn't need to change how it identifies people/sets.
--   * Times are stored as TIME so ranges are queryable; the client formats
--     them back to "HH:MM" (the shape app.js already uses).
--   * All tables are RLS-protected: only an authenticated admin can touch them,
--     same posture as Stage 1.
-- ---------------------------------------------------------------------------

-- ============================ tables =======================================

-- People (identity — stable across schedule sets).
create table if not exists public.staff (
  id         text primary key,                 -- existing app id, e.g. "Naoko0"
  name       text not null,
  role       text not null,                     -- Sub | Specialist | Lead | Assistant | Staff
  subject    text,
  room       text,
  email      text unique,                        -- Workspace email = Google Calendar id (Stage 3); nullable
  updated_at timestamptz not null default now()
);

-- Schedule sets (a school year / period with a date range).
create table if not exists public.schedule_sets (
  id         text primary key,                 -- existing app id, e.g. "primary"
  name       text not null,
  start_date date not null,
  end_date   date not null,
  sort_order int  not null default 0,           -- preserves set ordering in the UI
  updated_at timestamptz not null default now()
);

-- Which staff participate in which set (was person.activeSets).
create table if not exists public.staff_set_membership (
  staff_id text not null references public.staff(id)          on delete cascade,
  set_id   text not null references public.schedule_sets(id)  on delete cascade,
  primary key (staff_id, set_id)
);

-- The weekly recurring availability grid (the bulk of the data).
-- One row per person / set / weekday / time-block. Was person.sets[set][day][].
create table if not exists public.schedule_blocks (
  id       bigint generated always as identity primary key,
  staff_id text not null references public.staff(id)         on delete cascade,
  set_id   text not null references public.schedule_sets(id) on delete cascade,
  weekday  text not null check (weekday in ('Mon','Tue','Wed','Thu','Fri')),
  t0       time not null,                        -- block start (was "t0")
  t1       time not null,                        -- block end   (was "t1")
  status   text not null check (status in ('busy','free','off')),  -- was "s" (off = break / not on site)
  label    text,                                 -- was "l"
  priority text check (priority in ('hi','lo')), -- was "c"
  unique (staff_id, set_id, weekday, t0)
);
create index if not exists schedule_blocks_lookup
  on public.schedule_blocks (set_id, weekday, staff_id);

-- Absences / call-outs (was callouts "isoDate:personId").
create table if not exists public.absences (
  staff_id  text not null references public.staff(id) on delete cascade,
  absent_on date not null,
  created_at timestamptz not null default now(),
  primary key (staff_id, absent_on)
);
create index if not exists absences_by_date on public.absences (absent_on);

-- Manual coverage overrides (was overrides map "isoDate:slotKey" -> personId).
-- A row with assigned_staff_id NULL means "forced unfilled" (the old ""),
-- which is distinct from having no override row at all.
create table if not exists public.coverage_overrides (
  on_date           date not null,
  slot_key          text not null,              -- the app's existing slotKey string
  assigned_staff_id text references public.staff(id) on delete set null,
  updated_at        timestamptz not null default now(),
  primary key (on_date, slot_key)
);
create index if not exists overrides_by_date on public.coverage_overrides (on_date);

-- ============================ RLS ==========================================
-- Same posture as Stage 1: any authenticated (signed-in) user may read/write;
-- the anonymous role gets nothing. Single-admin app; tighten later if needed.

alter table public.staff                enable row level security;
alter table public.schedule_sets        enable row level security;
alter table public.staff_set_membership enable row level security;
alter table public.schedule_blocks      enable row level security;
alter table public.absences             enable row level security;
alter table public.coverage_overrides   enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'staff','schedule_sets','staff_set_membership',
    'schedule_blocks','absences','coverage_overrides'
  ]
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
    execute format('drop policy if exists "%s all for authenticated" on public.%I;', t, t);
    execute format(
      'create policy "%s all for authenticated" on public.%I '
      || 'for all to authenticated using (true) with check (true);', t, t);
  end loop;
end $$;
