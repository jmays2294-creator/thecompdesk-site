-- ─────────────────────────────────────────────────────────────────────────────
-- 111 / 20260805190000 — Paid Attorney Directory + AI intake chat
--
-- Companion to SILENT_OWNER_POLICY.md as amended 2026-08-05, which splits two
-- products that were previously conflated:
--
--   connection service  — neutral round-robin assignment. attorney_accounts /
--                         participating_attorneys. The operator and his firm are
--                         PERMANENTLY EXCLUDED. Untouched by this migration.
--
--   paid directory      — disclosed attorney advertising. directory_profiles,
--                         introduced here. The operator participates by design.
--
-- WHY A NEW TABLE RATHER THAN EXTENDING attorney_accounts
-- ────────────────────────────────────────────────────────
-- attorney_accounts carries ~10 of the columns a listing needs (firm_name,
-- attorney_name, office_address, phone_e164, public_email, website,
-- practice_areas, languages, headshot_url, bio), so extending it looks like the
-- frugal choice. It is not, and the reason is a security boundary rather than a
-- schema-design preference.
--
-- attorney_accounts IS the connection-service participant table. It backs the
-- participating_attorneys view, which carries a live anon read path
-- (attorney_accounts_public_directory_read: anon SELECT where status='active',
-- plus column-level SELECT grants on 14 columns) established by the migration
-- flagged "HIGHEST-CARE". A row in that table means, semantically, "may receive a
-- neutral rotation assignment."
--
-- Putting the operator's paid listing in that table would make his exclusion a
-- WHERE clause — a discriminator column that the view, its policy, and every
-- future query would have to remember. Any code path that forgot it would surface
-- the owner as a participating firm on /find-attorney, silently falsifying the
-- public neutrality disclosure and tripping RPC 7.1. That is the same proxy-pass
-- failure the CI guard exists to prevent, relocated into the schema.
--
-- Separate tables make the exclusion STRUCTURAL — enforced by a row's absence,
-- which nothing can forget — instead of CONDITIONAL. Given that the CI guard, the
-- public disclosure, and the bar rule all depend on that exclusion holding,
-- structural is worth one extra table.
--
-- Two supporting facts, both checked rather than assumed:
--   • attorney_accounts currently holds 0 rows, so "reuse the existing data" buys
--     nothing — there is no existing data.
--   • the overlap is ~10 of ~30 needed columns. slug, sort_rank, is_founder, seo,
--     and the eight chat_* columns are meaningless on a connection-service row and
--     would sit NULL on every one of them.
--
-- GRANTS — and a correction to the received wisdom here.
--
-- advisor_revoke_anon_execute_on_definer_fns (applied) states that "policies run
-- with internal privileges, so revoking anon/authenticated EXECUTE does NOT break
-- policy evaluation." That is FALSE for a function called inside a policy
-- expression, and believing it cost this migration two follow-ups. Postgres
-- evaluates USING/WITH CHECK as the QUERYING role, so that role needs EXECUTE on
-- any function the expression calls. SECURITY DEFINER sets the privileges the body
-- runs with, not the caller's right to invoke it. Verified, not reasoned about:
--
--   set local role authenticated;
--   select count(*) from public.directory_chats;
--   ERROR: 42501: permission denied for function owns_directory_chat
--
-- That is the April 2026 failure mode exactly — a missing authenticated grant
-- making a check fall through — and it is why grant_execute_rls_helpers_to_
-- authenticated had to be applied AFTER the advisor revocations, and why
-- is_firm_admin / is_firm_member / is_admin_of_user carry an authenticated grant
-- in production today.
--
-- Second trap: "revoke from anon, authenticated" alone is not enough. Postgres
-- grants EXECUTE to PUBLIC by default and both roles inherit it, so the revoke
-- must name PUBLIC or anon keeps access by inheritance (proacl "=X/postgres").
--
-- Correct grants:
--   owns_directory_chat         authenticated YES (every policy on it is "to
--                               authenticated"); anon NO; PUBLIC NO
--   touch_directory_updated_at  nobody — a TRIGGER function, and triggers do
--                               genuinely bypass EXECUTE checks
--
-- Confirmed post-apply: anon=false, authenticated=true, service_role=true; the
-- security advisor gained no new ERROR and no new anon_security_definer finding.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── directory_profiles ───────────────────────────────────────────────────────
-- One row per LISTING. A firm gets one row, not one per attorney.
create table if not exists public.directory_profiles (
  id                     uuid primary key default gen_random_uuid(),
  slug                   text unique not null,
  kind                   text not null check (kind in ('attorney','firm')),
  status                 text not null default 'draft'
                           check (status in ('draft','published','paused')),

  display_name           text not null,
  headline               text,
  firm_name              text,
  photo_url              text,
  photo_alt              text,
  bio_md                 text,
  credentials            jsonb not null default '[]'::jsonb,
  practice_areas         text[] not null default '{}',
  counties               text[] not null default '{}',
  languages              text[] not null default '{English}',

  -- Per-row contact so a swap to a dedicated line is one UPDATE, not a code change.
  public_phone_e164      text,
  public_phone_display   text,
  public_email           text,
  website_url            text,
  office_address         text,
  links                  jsonb not null default '{}'::jsonb,

  is_founder             boolean not null default false,
  show_webinars_cta      boolean not null default false,

  chat_enabled           boolean not null default true,
  chat_agent_name        text default 'Alina',
  chat_agent_avatar_url  text,
  chat_greeting          text,
  chat_banner_text       text,

  attorney_user_id       uuid references auth.users(id) on delete set null,
  notify_email           text not null,
  notify_sms_e164        text,

  seo                    jsonb not null default '{}'::jsonb,
  sort_rank              integer not null default 100,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.directory_profiles is
  'Paid attorney-advertising listings for /directory. Distinct from attorney_accounts, '
  'which is the neutral connection service and from which the operator is permanently '
  'excluded. See SILENT_OWNER_POLICY.md as amended 2026-08-05.';

create index if not exists directory_profiles_published_idx
  on public.directory_profiles (status, sort_rank)
  where status = 'published';

-- ── directory_chats ──────────────────────────────────────────────────────────
create table if not exists public.directory_chats (
  id                      uuid primary key default gen_random_uuid(),
  directory_profile_id    uuid not null
                            references public.directory_profiles(id) on delete cascade,
  session_token           text unique not null,

  intent                  text not null default 'unknown'
                            check (intent in ('unknown','lead','info_only',
                                              'has_counsel','out_of_scope','abandoned')),
  status                  text not null default 'open'
                            check (status in ('open','routed','attorney_replied','closed')),

  visitor_name            text,
  visitor_email           text,
  visitor_phone_e164      text,
  date_of_injury          date,
  body_parts              text[] not null default '{}',

  summary_for_attorney    text,
  question_presented      text,

  locale                  text not null default 'en',
  consent_at              timestamptz,
  consent_copy_version    text,
  ip_hash                 text,
  user_agent              text,

  routed_at               timestamptz,
  first_attorney_reply_at timestamptz,
  closed_at               timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists directory_chats_profile_idx
  on public.directory_chats (directory_profile_id, created_at desc);

-- ── directory_chat_messages ──────────────────────────────────────────────────
create table if not exists public.directory_chat_messages (
  id                uuid primary key default gen_random_uuid(),
  chat_id           uuid not null references public.directory_chats(id) on delete cascade,
  role              text not null check (role in ('visitor','agent','attorney','system')),
  body              text not null,
  is_internal       boolean not null default false,
  resend_message_id text,
  created_at        timestamptz not null default now()
);

create index if not exists directory_chat_messages_chat_idx
  on public.directory_chat_messages (chat_id, created_at);

-- ── directory_chat_events (append-only audit) ────────────────────────────────
create table if not exists public.directory_chat_events (
  id         uuid primary key default gen_random_uuid(),
  chat_id    uuid not null references public.directory_chats(id) on delete cascade,
  event      text not null,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists directory_chat_events_chat_idx
  on public.directory_chat_events (chat_id, created_at);

-- ── updated_at maintenance ───────────────────────────────────────────────────
-- search_path pinned per 20260518120000_advisor_pin_search_path_on_trigger_fns.
create or replace function public.touch_directory_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.touch_directory_updated_at() from public;

drop trigger if exists directory_profiles_touch on public.directory_profiles;
create trigger directory_profiles_touch
  before update on public.directory_profiles
  for each row execute function public.touch_directory_updated_at();

drop trigger if exists directory_chats_touch on public.directory_chats;
create trigger directory_chats_touch
  before update on public.directory_chats
  for each row execute function public.touch_directory_updated_at();

-- ── ownership helper (policy evaluation ONLY — granted to neither role) ───────
create or replace function public.owns_directory_chat(p_chat_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from public.directory_chats c
      join public.directory_profiles p on p.id = c.directory_profile_id
     where c.id = p_chat_id
       and p.attorney_user_id = (select auth.uid())
  );
$$;

comment on function public.owns_directory_chat(uuid) is
  'RLS helper. Cross-table lookup goes through SECURITY DEFINER so a policy never '
  'reads another RLS-protected table directly (42P17 recursion, April 2026). Called '
  'only from policies, never from client code, so EXECUTE is granted to neither anon '
  'nor authenticated per the applied advisor hardening.';

-- PUBLIC must be named explicitly; anon/authenticated inherit from it.
revoke execute on function public.owns_directory_chat(uuid) from public;
-- ...but the policies below call this helper as the querying role, so authenticated
-- needs it back. Omitting this line reproduces the April 2026 outage.
grant execute on function public.owns_directory_chat(uuid) to authenticated;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.directory_profiles      enable row level security;
alter table public.directory_chats         enable row level security;
alter table public.directory_chat_messages enable row level security;
alter table public.directory_chat_events   enable row level security;

-- Published listings are public. No public write of any kind.
drop policy if exists directory_profiles_public_read on public.directory_profiles;
create policy directory_profiles_public_read
  on public.directory_profiles
  for select
  to anon, authenticated
  using (status = 'published');

-- An attorney may read their own listing regardless of status (draft preview).
drop policy if exists directory_profiles_owner_read on public.directory_profiles;
create policy directory_profiles_owner_read
  on public.directory_profiles
  for select
  to authenticated
  using (attorney_user_id = (select auth.uid()));

-- Chats/messages/events: NO anon access at all. Visitor reads and writes go
-- exclusively through the edge function on the service role, keyed by
-- session_token. session_token deliberately does NOT appear in any policy — it
-- would have to travel in a client query and is enumerable in logs.
drop policy if exists directory_chats_attorney_read on public.directory_chats;
create policy directory_chats_attorney_read
  on public.directory_chats
  for select
  to authenticated
  using (public.owns_directory_chat(id));

drop policy if exists directory_chats_attorney_update on public.directory_chats;
create policy directory_chats_attorney_update
  on public.directory_chats
  for update
  to authenticated
  using (public.owns_directory_chat(id))
  with check (public.owns_directory_chat(id));

drop policy if exists directory_chat_messages_attorney_read on public.directory_chat_messages;
create policy directory_chat_messages_attorney_read
  on public.directory_chat_messages
  for select
  to authenticated
  using (public.owns_directory_chat(chat_id));

drop policy if exists directory_chat_messages_attorney_insert on public.directory_chat_messages;
create policy directory_chat_messages_attorney_insert
  on public.directory_chat_messages
  for insert
  to authenticated
  with check (public.owns_directory_chat(chat_id) and role = 'attorney');

drop policy if exists directory_chat_events_attorney_read on public.directory_chat_events;
create policy directory_chat_events_attorney_read
  on public.directory_chat_events
  for select
  to authenticated
  using (public.owns_directory_chat(chat_id));

-- Rate limiting reuses anonymous_chat_quota with surface='directory'. It is
-- already multi-surface ('job_duties', 'extension'). No new table.

commit;
