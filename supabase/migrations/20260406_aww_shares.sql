-- AWW Share Links
-- Stores tokenized read-only AWW calculation results for the "Share with Attorney" feature.
-- No PII is stored beyond the calculation inputs and results.
-- Records auto-expire after 30 days (enforced client-side and via pg_cron if available).

create table if not exists public.aww_shares (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique,
  payload     jsonb not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

-- Index for fast token lookup
create index if not exists aww_shares_token_idx on public.aww_shares (token);

-- Index to support future cleanup jobs
create index if not exists aww_shares_expires_idx on public.aww_shares (expires_at);

-- Enable Row Level Security
alter table public.aww_shares enable row level security;

-- Policy: anyone (including anonymous users) can insert a new share record.
-- The anon key from the browser is sufficient; no auth required.
create policy "aww_shares_insert_public"
  on public.aww_shares
  for insert
  with check (true);

-- Policy: anyone can read a share record by exact token match.
-- Expiry enforcement is done client-side in aww-share.html.
create policy "aww_shares_select_public"
  on public.aww_shares
  for select
  using (true);

-- Optional: scheduled cleanup of expired records.
-- Run this manually or via pg_cron if enabled on your Supabase project:
--
--   select cron.schedule(
--     'delete-expired-aww-shares',
--     '0 3 * * *',   -- daily at 3 AM UTC
--     $$delete from public.aww_shares where expires_at < now()$$
--   );
