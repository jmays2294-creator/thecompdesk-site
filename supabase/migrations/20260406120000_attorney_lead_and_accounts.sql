-- Migration: attorney_leads and attorney_accounts tables
-- Find an Attorney lead-gen page: injured-worker intake + attorney subscription directory
-- Timestamp: 2026-04-06 12:00:00

-- ============================================================
-- TABLE: attorney_leads
-- Stores injured-worker intake submissions from the web form.
-- Insertions are performed only via the submit-attorney-lead
-- edge function (which re-validates and rate-limits).
-- ============================================================
create table public.attorney_leads (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  source               text not null check (source in ('web', 'ios')),
  source_version       text,
  first_name           text not null,
  last_name            text not null,
  phone_e164           text not null,
  email                text not null,
  date_of_accident     date not null,
  employer_name        text not null,
  accident_description text not null,
  injuries             text not null,
  preferred_contact    text not null check (preferred_contact in ('phone', 'email', 'either')),
  best_time            text,
  geo_lat              double precision,
  geo_lng              double precision,
  geo_zip              text,
  geo_consent          boolean not null default false,
  tcpa_consent         boolean not null default false,
  disclaimer_ack       boolean not null default false,
  user_agent           text,
  ip_hash              text,
  utm                  jsonb,
  status               text not null default 'new'
                         check (status in ('new', 'emailed', 'contacted', 'closed')),
  routed_to            text
);

-- Default-deny RLS: all mutations go through edge functions which use the service key.
alter table public.attorney_leads enable row level security;

-- No RLS policies — inserts and reads are handled exclusively by edge functions
-- using the service-role key (which bypasses RLS). Direct client access is denied.


-- ============================================================
-- TABLE: attorney_accounts
-- Attorney firm profiles + subscription status.
-- Created during the attorney signup flow.
-- Status is managed by the stripe-webhook edge function.
-- ============================================================
create table public.attorney_accounts (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  created_at           timestamptz not null default now(),
  firm_name            text not null,
  attorney_name        text not null,
  bar_number           text,
  office_address       text not null,
  office_lat           double precision,
  office_lng           double precision,
  phone_e164           text not null,
  public_email         text not null,
  website              text,
  practice_areas       text[],
  languages            text[],
  headshot_url         text,
  bio                  text check (bio is null or char_length(bio) <= 500),
  stripe_customer_id   text,
  stripe_subscription_id text,
  status               text not null default 'pending'
                         check (status in ('pending', 'active', 'past_due', 'inactive')),
  unique (user_id)
);

-- Default-deny RLS.
alter table public.attorney_accounts enable row level security;

-- Authenticated attorneys can read and update their own account.
create policy "attorney reads own account"
  on public.attorney_accounts for select
  to authenticated
  using (user_id = auth.uid());

create policy "attorney updates own account"
  on public.attorney_accounts for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Inserts are handled by the create-attorney-checkout edge function (service key).
-- Status updates are handled by the stripe-webhook edge function (service key).


-- ============================================================
-- VIEW: participating_attorneys
-- Public-facing view: only active accounts, no PII fields.
-- Consumed by the map on find-attorney.html.
-- Sort order is INTENTIONALLY omitted — the client sorts by
-- distance from the user using purely Euclidean/Haversine math
-- with NO firm preference. See tests/find-attorney-map-sort.test.js.
-- ============================================================
create view public.participating_attorneys as
  select
    id,
    firm_name,
    attorney_name,
    office_address,
    office_lat,
    office_lng,
    phone_e164,
    public_email,
    website,
    practice_areas,
    languages,
    bio
  from public.attorney_accounts
  where status = 'active';

-- Grant public read access on the view (not on the underlying table).
grant select on public.participating_attorneys to anon, authenticated;

-- Indexes for common queries.
create index on public.attorney_leads (created_at desc);
create index on public.attorney_leads (ip_hash, created_at);
create index on public.attorney_leads (email, created_at);
create index on public.attorney_leads (phone_e164, created_at);
create index on public.attorney_accounts (status);
create index on public.attorney_accounts (stripe_customer_id);
create index on public.attorney_accounts (stripe_subscription_id);
