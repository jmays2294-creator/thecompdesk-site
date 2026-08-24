-- ============================================================================
-- workspace_improvement_loop
--
-- Backend for the perpetual Pro-workspace improvement loop — the website
-- counterpart to app_e2e_runs / app_improvements.
--
-- Three tables:
--   workspace_e2e_runs    one row per sweep (nightly Playwright, or attended)
--   workspace_improvements one row per finding, cradle to merge
--   workspace_telemetry   what attorneys actually DO in the workspace
--
-- PRIVACY POSTURE — read this before adding a column.
-- Attorneys type privileged client data into these tiles: names, WCB case
-- numbers, dates of injury, exact wages. NONE of it may land here. The
-- telemetry table stores STRUCTURE (which tile, which order, which field was
-- filled, where the session died) and BUCKETED SHAPE (AWW band, DOI year) and
-- nothing else. A trigger enforces this at write time rather than trusting the
-- client, because the client is a static file anyone can fork and because a
-- privilege leak is not the kind of bug you find later.
--
-- The trigger RAISES rather than silently scrubbing. That is deliberate: a
-- silent scrub means a bad emitter ships and nobody learns. The client-side
-- emitter is fire-and-forget with a catch, so a raise costs a dropped event
-- and never interrupts the attorney's work.
--
-- FAIL-LOUD / RLS rules followed here, per ops/dev claude.md Database
-- Operations Playbook:
--   * cross-table lookups in policies go through existing SECURITY DEFINER
--     helpers (has_admin_role) — never a raw subquery that can recurse
--   * auth.uid() is always wrapped as (select auth.uid())
--   * every view is security_invoker=true — a SECURITY DEFINER view would
--     hand telemetry to any authenticated caller
-- ============================================================================

-- ── 1. sweep runs ───────────────────────────────────────────────────────────
create table if not exists public.workspace_e2e_runs (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null default 'full_sweep'
                   check (kind in ('full_sweep','regression_verify','targeted','manual')),
  surface        text not null default 'pro_web'
                   check (surface in ('pro_web','worker_web','both')),
  origin         text,                    -- http://127.0.0.1:PORT or https://thecompdesk.com
  site_sha       text,
  branch         text,
  browser        text,
  runner         text not null default 'playwright_local'
                   check (runner in ('playwright_local','chrome_attended','ci')),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text not null default 'running'
                   check (status in ('running','pass','warn','fail','aborted')),
  routes_total   integer,
  routes_pass    integer,
  routes_fail    integer,
  console_errors integer,
  -- Per-tier execution record. A tier that could not execute is recorded as
  -- 'did_not_run' and forces status='warn'. "Did not run" is NOT "pass" — this
  -- project has been burned repeatedly by a check that measured a proxy and
  -- reported green.
  tiers          jsonb not null default '{}'::jsonb,
  report_path    text,
  summary        jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists workspace_e2e_runs_started_idx
  on public.workspace_e2e_runs (started_at desc);

-- ── 2. improvements ─────────────────────────────────────────────────────────
create table if not exists public.workspace_improvements (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid references public.workspace_e2e_runs(id) on delete set null,
  source        text not null default 'sweep'
                  check (source in ('sweep','telemetry','a11y','visual','manual','support')),
  proposed_week date not null default (now() at time zone 'America/New_York')::date,

  title         text not null,
  surface       text,                     -- workspace | calculators | dashboard | account | feeapp | upgrade
  route         text,                     -- /workspace, /calculators/slu, ...
  category      text,                     -- cohesion | discoverability | copy | a11y | performance | correctness | workflow
  severity      text check (severity in ('P0','P1','P2','P3')),

  -- RISK CLASS drives the tiered approval gate. 'safe' items auto-approve;
  -- 'guarded' items wait for Joel's explicit click. The planner assigns this,
  -- and the constraint below is the backstop: anything touching calculation
  -- math, fee-app output, tier gating, persistence/sync or auth is guarded by
  -- definition, no matter how small the diff looks.
  risk_class    text not null default 'guarded'
                  check (risk_class in ('safe','guarded')),

  problem       text,
  evidence      text,
  telemetry_evidence jsonb,               -- the query + numbers that motivated it
  proposal      text,
  goals         text[] default '{}',

  feasibility   text,
  est_hours     numeric,
  est_basis     text,
  touches       text[] default '{}',
  risks         text,
  guards        text[] default '{}',
  steps         jsonb,
  depends_on    uuid[] default '{}',
  planned_at    timestamptz,

  status        text not null default 'proposed'
                  check (status in ('proposed','planned','approved','deferred','rejected',
                                    'in_progress','implemented','failed','verified','merged')),
  auto_approved boolean not null default false,
  decided_at    timestamptz,
  decided_by    uuid,
  decision_note text,

  branch        text,
  commit_sha    text,
  preview_url   text,
  implemented_at timestamptz,
  implementation_note text,
  guard_results jsonb,

  merged_at     timestamptz,
  merge_sha     text,

  verify_run_id uuid references public.workspace_e2e_runs(id) on delete set null,
  verified_at   timestamptz,
  verify_result text check (verify_result in ('pass','fail','partial','did_not_run')),
  verify_note   text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- An auto-approved item must be 'safe'. Belt and braces against a planner bug
  -- quietly shipping calc-logic changes nobody approved.
  constraint workspace_improvements_autoapprove_safe_only
    check (auto_approved = false or risk_class = 'safe')
);

create index if not exists workspace_improvements_status_idx
  on public.workspace_improvements (status, proposed_week desc);
create index if not exists workspace_improvements_run_idx
  on public.workspace_improvements (run_id);

-- ── 3. telemetry ────────────────────────────────────────────────────────────
create table if not exists public.workspace_telemetry (
  id           bigserial primary key,
  event_id     uuid not null default gen_random_uuid(),
  session_id   text not null,
  user_id      uuid,
  anon_id      text,

  tier_at_use        text,
  designation_at_use text,

  surface      text not null,             -- workspace | calculators | dashboard | account | feeapp | upgrade
  route        text,
  tile_type    text,                      -- 'slu' | 'ccp' | 'aww' ... NEVER a case name
  tile_ref     text,                      -- opaque per-session tile handle, e.g. 't3'

  action       text not null
                 check (action in (
                   'session_start','session_end',
                   'tile_add','tile_open','tile_close','tile_remove','tile_reorder','tile_duplicate',
                   'field_focus','field_filled','field_cleared',
                   'calc_run','calc_result','calc_error','validation_error',
                   'save','save_failed','load','export','print','copy_result',
                   'feeapp_open','feeapp_generate','feeapp_abandon',
                   'help_open','tooltip_open','tour_start','tour_complete','tour_abandon',
                   'paywall_view','upgrade_click',
                   'nav','search','undo','abandon','error'
                 )),

  seq                    integer,         -- order within the session
  ms_since_session_start integer,
  ms_since_prev          integer,

  fields_filled text[] default '{}',      -- FIELD NAMES only, never values
  buckets      jsonb not null default '{}'::jsonb,  -- bucketed shape, see trigger
  error_code   text,
  props        jsonb not null default '{}'::jsonb,

  ts           timestamptz not null default now(),
  received_at  timestamptz not null default now()
);

create unique index if not exists workspace_telemetry_event_id_key
  on public.workspace_telemetry (event_id);
create index if not exists workspace_telemetry_session_idx
  on public.workspace_telemetry (session_id, seq);
create index if not exists workspace_telemetry_ts_idx
  on public.workspace_telemetry (ts desc);
create index if not exists workspace_telemetry_action_idx
  on public.workspace_telemetry (action, ts desc);
create index if not exists workspace_telemetry_tile_idx
  on public.workspace_telemetry (tile_type, action);

-- ── 4. the privacy guard ────────────────────────────────────────────────────
-- Rejects anything that looks like real case data before it is stored.
-- Deliberately conservative: it is cheaper to lose a telemetry event than to
-- store a claimant's name.
create or replace function public.tg_workspace_telemetry_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v text;
  k text;
begin
  -- field names: identifiers, not prose
  if new.fields_filled is not null then
    foreach v in array new.fields_filled loop
      if length(v) > 48 or v ~ '[0-9]{6,}' then
        raise exception 'workspace_telemetry: fields_filled must carry field NAMES, got %', left(v, 40)
          using errcode = 'check_violation';
      end if;
    end loop;
  end if;

  -- every string leaf in buckets/props gets the same treatment
  for k, v in
    select key, value
    from jsonb_each_text(coalesce(new.buckets, '{}'::jsonb) || coalesce(new.props, '{}'::jsonb))
  loop
    if v is null then continue; end if;
    if length(v) > 64 then
      raise exception 'workspace_telemetry: value for "%" is % chars — telemetry stores shape, not content', k, length(v)
        using errcode = 'check_violation';
    end if;
    -- 6+ consecutive digits: WCB case numbers, SSNs, phone numbers, claim ids
    if v ~ '[0-9]{6,}' then
      raise exception 'workspace_telemetry: value for "%" looks like an identifier, not a bucket', k
        using errcode = 'check_violation';
    end if;
    -- full ISO dates: a date of injury is client data. Year buckets are fine.
    if v ~ '^\d{4}-\d{2}-\d{2}' then
      raise exception 'workspace_telemetry: value for "%" is a full date — bucket to year', k
        using errcode = 'check_violation';
    end if;
    if position('@' in v) > 0 then
      raise exception 'workspace_telemetry: value for "%" contains an email address', k
        using errcode = 'check_violation';
    end if;
  end loop;

  new.received_at := now();
  return new;
end;
$$;

drop trigger if exists workspace_telemetry_guard on public.workspace_telemetry;
create trigger workspace_telemetry_guard
  before insert or update on public.workspace_telemetry
  for each row execute function public.tg_workspace_telemetry_guard();

-- ── 5. RLS ──────────────────────────────────────────────────────────────────
alter table public.workspace_e2e_runs     enable row level security;
alter table public.workspace_improvements enable row level security;
alter table public.workspace_telemetry    enable row level security;

drop policy if exists workspace_e2e_runs_admin_all on public.workspace_e2e_runs;
create policy workspace_e2e_runs_admin_all on public.workspace_e2e_runs
  for all to authenticated using (has_admin_role()) with check (has_admin_role());

drop policy if exists workspace_improvements_admin_all on public.workspace_improvements;
create policy workspace_improvements_admin_all on public.workspace_improvements
  for all to authenticated using (has_admin_role()) with check (has_admin_role());

-- Anyone may write their own telemetry; only admins may read it back. This
-- mirrors analytics_events, and it is what keeps one attorney from ever seeing
-- another attorney's workflow.
drop policy if exists workspace_telemetry_insert_own on public.workspace_telemetry;
create policy workspace_telemetry_insert_own on public.workspace_telemetry
  for insert to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));

drop policy if exists workspace_telemetry_select_admin on public.workspace_telemetry;
create policy workspace_telemetry_select_admin on public.workspace_telemetry
  for select to authenticated using (has_admin_role());

-- ── 6. rollup views ─────────────────────────────────────────────────────────
-- These are what the planner reads. Each is security_invoker so the admin-only
-- SELECT policy above still governs.

-- Which tiles get used together in one sitting. This is the raw material for
-- "saved workflow" presets — if SLU and CCP co-occur in 70% of sessions, that
-- pairing should be one click, not two searches through the palette.
create or replace view public.workspace_tile_cooccurrence
with (security_invoker = true) as
with per_session as (
  select session_id,
         max(tier_at_use) as tier,
         array_agg(distinct tile_type) filter (where tile_type is not null) as tiles
  from public.workspace_telemetry
  where action in ('tile_add','tile_open','calc_run')
  group by session_id
)
select a.tile as tile_a,
       b.tile as tile_b,
       count(*)::int as sessions_together
from per_session s,
     lateral unnest(s.tiles) as a(tile),
     lateral unnest(s.tiles) as b(tile)
where a.tile < b.tile
group by 1, 2
order by sessions_together desc;

-- Session shape: how long, how many tiles, did it end in a saved result or a
-- shrug. 'productive' is the honest definition of activation for this surface.
create or replace view public.workspace_session_rollup
with (security_invoker = true) as
select session_id,
       min(ts)                                   as started_at,
       max(ts)                                   as ended_at,
       max(tier_at_use)                          as tier,
       max(designation_at_use)                   as designation,
       count(*)::int                             as events,
       count(distinct tile_type)::int            as distinct_tiles,
       count(*) filter (where action = 'calc_run')::int          as calcs_run,
       count(*) filter (where action = 'calc_error')::int        as calc_errors,
       count(*) filter (where action = 'validation_error')::int  as validation_errors,
       count(*) filter (where action = 'save')::int              as saves,
       count(*) filter (where action = 'feeapp_generate')::int   as fee_apps,
       count(*) filter (where action = 'paywall_view')::int      as paywall_views,
       (count(*) filter (where action in ('save','export','feeapp_generate')) > 0) as productive,
       extract(epoch from (max(ts) - min(ts)))::int              as duration_s,
       (array_agg(action order by seq desc))[1]                  as last_action,
       (array_agg(coalesce(route, surface) order by seq desc))[1] as last_route
from public.workspace_telemetry
group by session_id;

-- Where sessions die. The last action before a session that never produced
-- anything is the single most actionable number this loop has.
create or replace view public.workspace_drop_off
with (security_invoker = true) as
select last_action,
       last_route,
       tier,
       count(*)::int                    as sessions,
       round(avg(duration_s))::int      as avg_duration_s,
       round(avg(distinct_tiles), 1)    as avg_tiles
from public.workspace_session_rollup
where not productive
group by 1, 2, 3
order by sessions desc;

-- Which fields inside a tile actually get filled. A field nobody fills is
-- either badly labelled, badly placed, or should not be on the first screen.
create or replace view public.workspace_field_fill
with (security_invoker = true) as
select tile_type,
       f.field,
       count(*)::int as fills,
       count(distinct session_id)::int as sessions
from public.workspace_telemetry t,
     lateral unnest(t.fields_filled) as f(field)
where t.action = 'field_filled'
group by 1, 2
order by tile_type, fills desc;

comment on table public.workspace_telemetry is
  'Structural + bucketed usage of the Pro workspace. NEVER stores case values — '
  'no names, no WCB numbers, no full dates, no exact dollars. Enforced by '
  'tg_workspace_telemetry_guard, which raises rather than scrubs.';
comment on column public.workspace_improvements.risk_class is
  'safe = auto-approvable (copy, spacing, a11y, empty states). guarded = needs '
  'Joel''s explicit approval (calc math, fee-app output, tier gating, '
  'persistence/sync, auth). Enforced with auto_approved by a table constraint.';
