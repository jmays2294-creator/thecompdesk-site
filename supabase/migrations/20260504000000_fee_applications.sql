-- 20260504000000_fee_applications.sql
--
-- Pro Workspace v1.2 — store generated OC-400.1 fee applications for
-- attorney history. We DO NOT store the PDF bytes in the row (that bloats
-- the workspace_data row and slows realtime); pdf_bytes is just the size
-- in bytes, used as a sanity-check + future "regenerate" affordance.
--
-- RLS: only the attorney who created the row can read it. No firm-wide
-- visibility today; we'll revisit when a firm-attorney ever needs to see
-- a colleague's fee history (probably a future "firm fee dashboard").

create table if not exists public.fee_applications (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references auth.users(id) on delete cascade,
    claimant_name   text,
    wcb_number      text,
    doi             date,
    aww             numeric(12,2),
    fee_requested   numeric(12,2),
    fee_equation    text,
    used_template   boolean not null default false,
    pdf_bytes       integer,
    created_at      timestamptz not null default now()
);

create index if not exists fee_applications_user_id_created_at_idx
    on public.fee_applications (user_id, created_at desc);

alter table public.fee_applications enable row level security;

-- Owner-only policies. Per Apr 27 RLS lesson in CLAUDE.md, every reference
-- to auth.uid() is wrapped in a subselect so Postgres caches it once per
-- query (not per row).
drop policy if exists "fee_apps_select_own" on public.fee_applications;
create policy "fee_apps_select_own" on public.fee_applications
    for select using (user_id = (select auth.uid()));

drop policy if exists "fee_apps_insert_own" on public.fee_applications;
create policy "fee_apps_insert_own" on public.fee_applications
    for insert with check (user_id = (select auth.uid()));

drop policy if exists "fee_apps_update_own" on public.fee_applications;
create policy "fee_apps_update_own" on public.fee_applications
    for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "fee_apps_delete_own" on public.fee_applications;
create policy "fee_apps_delete_own" on public.fee_applications
    for delete using (user_id = (select auth.uid()));

comment on table public.fee_applications is
    'OC-400.1 fee applications generated from the Pro Attorney Workspace. v1.2.';
