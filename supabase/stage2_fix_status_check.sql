-- One-off patch: allow the 'off' status (break / not on site) on schedule_blocks.
-- The initial Stage 2 schema only permitted 'busy'/'free'; the real data also
-- uses 'off'. The table is empty at this point, so this is safe.
alter table public.schedule_blocks drop constraint if exists schedule_blocks_status_check;
alter table public.schedule_blocks add  constraint schedule_blocks_status_check
  check (status in ('busy','free','off'));
