-- ─────────────────────────────────────────────────────────────────────────────
-- wc_doctors: directory of workers'-comp-experienced medical providers
-- Scope (initial): NYC five boroughs. Statewide rows allowed for future expansion.
-- Read: public (anon + authenticated). Writes: service-role only.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.wc_doctors (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  npi                     varchar(10),
  name                    text NOT NULL,
  practice_name           text,
  specialty               text,
  subspecialty            text,
  borough                 text CHECK (borough IS NULL OR borough IN ('Manhattan','Brooklyn','Queens','Bronx','Staten Island')),
  address                 text,
  city                    text,
  state                   varchar(2) DEFAULT 'NY',
  zip                     varchar(10),
  lat                     numeric(9,6),
  lng                     numeric(9,6),
  phone                   varchar(20),
  website                 text,
  email                   text,
  languages               text[] DEFAULT ARRAY['English']::text[],
  body_parts              text[],
  accepting_new_patients  boolean DEFAULT true,
  wcb_authorized          boolean DEFAULT true,
  wcb_provider_id         text,
  notes                   text,
  source                  text DEFAULT 'manual',
  last_verified_at        timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.wc_doctors IS
  'Directory of NY medical providers experienced with workers compensation cases. '
  'Public read. Post-2024 CRRP legislation no longer requires WCB authorization for most providers — '
  'wcb_authorized is informational only.';

CREATE INDEX IF NOT EXISTS wc_doctors_borough_idx   ON public.wc_doctors (borough)        WHERE borough IS NOT NULL;
CREATE INDEX IF NOT EXISTS wc_doctors_specialty_idx ON public.wc_doctors (specialty)      WHERE specialty IS NOT NULL;
CREATE INDEX IF NOT EXISTS wc_doctors_zip_idx       ON public.wc_doctors (zip)            WHERE zip IS NOT NULL;
CREATE INDEX IF NOT EXISTS wc_doctors_geo_idx       ON public.wc_doctors (lat, lng)       WHERE lat IS NOT NULL AND lng IS NOT NULL;
CREATE INDEX IF NOT EXISTS wc_doctors_npi_idx       ON public.wc_doctors (npi)            WHERE npi IS NOT NULL;

ALTER TABLE public.wc_doctors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wc_doctors_public_read ON public.wc_doctors;
CREATE POLICY wc_doctors_public_read
  ON public.wc_doctors
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Writes are restricted to service-role only (default: no policy = no access for anon/authenticated).

-- search_path pinned per Supabase advisor 0011 (function_search_path_mutable).
-- Without this pin, a malicious schema in the session search_path could shadow now().
CREATE OR REPLACE FUNCTION public.wc_doctors_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wc_doctors_touch_updated_at ON public.wc_doctors;
CREATE TRIGGER wc_doctors_touch_updated_at
  BEFORE UPDATE ON public.wc_doctors
  FOR EACH ROW
  EXECUTE FUNCTION public.wc_doctors_touch_updated_at();
