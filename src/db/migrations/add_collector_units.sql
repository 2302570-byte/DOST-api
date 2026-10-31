-- =============================================================================
-- Migration: add_collector_units
-- Adds collector_units and collector_unit_members tables.
--
-- Safe to run on an existing database — all statements are idempotent.
-- Run with:
--   psql -d dostbesmart_db -f src/db/migrations/add_collector_units.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Status enum
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.collector_unit_status AS ENUM ('idle', 'en_route', 'at_depot');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2. collector_units
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.collector_units (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(100) NOT NULL,
  plate_number VARCHAR(30)  NOT NULL UNIQUE,
  status       public.collector_unit_status NOT NULL DEFAULT 'idle',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collector_units_status ON public.collector_units(status);

DROP TRIGGER IF EXISTS trg_collector_units_updated_at ON public.collector_units;
CREATE TRIGGER trg_collector_units_updated_at
  BEFORE UPDATE ON public.collector_units
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. collector_unit_members  (junction: unit ←→ collector)
-- UNIQUE on collector_id enforces one-unit-per-collector.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.collector_unit_members (
  unit_id      UUID NOT NULL REFERENCES public.collector_units(id) ON DELETE CASCADE,
  collector_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (unit_id, collector_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cum_one_unit_per_collector
  ON public.collector_unit_members(collector_id);

CREATE INDEX IF NOT EXISTS idx_cum_unit_id ON public.collector_unit_members(unit_id);
