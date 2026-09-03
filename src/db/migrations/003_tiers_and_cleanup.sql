-- BE-SMART Migration 003 - Dynamic Tiers + Waste Type Removal
-- Run against dostbesmart_db after 002_create_bins_and_scans.sql

-- 1. Create tiers table
CREATE TABLE IF NOT EXISTS public.tiers (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(50)  NOT NULL,
  capacity_liters  INTEGER,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 2. Auto updated_at trigger for tiers
DROP TRIGGER IF EXISTS trg_tiers_updated_at ON public.tiers;
CREATE TRIGGER trg_tiers_updated_at
  BEFORE UPDATE ON public.tiers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Seed default tiers (idempotent)
INSERT INTO public.tiers (name, capacity_liters)
SELECT 'Tier 1', 660
WHERE NOT EXISTS (SELECT 1 FROM public.tiers WHERE name = 'Tier 1');

INSERT INTO public.tiers (name, capacity_liters)
SELECT 'Tier 2', 1100
WHERE NOT EXISTS (SELECT 1 FROM public.tiers WHERE name = 'Tier 2');

INSERT INTO public.tiers (name, capacity_liters)
SELECT 'Tier 3', NULL
WHERE NOT EXISTS (SELECT 1 FROM public.tiers WHERE name = 'Tier 3');

-- 4. Add tier_id FK to bins (nullable so existing rows are not broken)
ALTER TABLE public.bins
  ADD COLUMN IF NOT EXISTS tier_id UUID REFERENCES public.tiers(id) ON DELETE SET NULL;

-- 5. Remove waste_type column from bins
ALTER TABLE public.bins
  DROP COLUMN IF EXISTS waste_type;

-- 6. Drop waste_type index if it exists
DROP INDEX IF EXISTS idx_bins_waste_type;

-- 7. Index on tier_id
CREATE INDEX IF NOT EXISTS idx_bins_tier_id ON public.bins(tier_id);
