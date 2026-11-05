-- =============================================================================
-- Migration 002: MRF facilities and reservations/bidding domain
--
-- Changes:
--   1. mrf_facilities table — named MRF locations with GPS coords, status,
--      capacity, and pricing for the bidding system
--   2. mrf_reservations table — buyer bids on full MRF facilities
--
-- Safe to re-run: all statements use IF NOT EXISTS / DO $$ guards.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. mrf_facilities
-- -----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE public.mrf_facility_status AS ENUM ('available', 'full', 'reserved', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.mrf_facilities (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(150) NOT NULL,
  barangay         VARCHAR(150) NOT NULL,
  address          TEXT,
  latitude         NUMERIC(10, 7),
  longitude        NUMERIC(10, 7),
  status           public.mrf_facility_status NOT NULL DEFAULT 'available',
  capacity_kg      NUMERIC(10, 2),
  starting_bid     NUMERIC(12, 2),
  buyout_price     NUMERIC(12, 2),
  managed_by       UUID         REFERENCES public.users(id) ON DELETE SET NULL,
  is_active        BOOLEAN      NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mrf_facilities_status   ON public.mrf_facilities(status);
CREATE INDEX IF NOT EXISTS idx_mrf_facilities_barangay ON public.mrf_facilities(barangay);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_mrf_facilities_updated_at ON public.mrf_facilities;
CREATE TRIGGER trg_mrf_facilities_updated_at
  BEFORE UPDATE ON public.mrf_facilities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed the four MRFs that were previously in mock data
INSERT INTO public.mrf_facilities
  (name, barangay, latitude, longitude, status, starting_bid, buyout_price)
VALUES
  ('MRF Alangilan', 'Brgy. Alangilan',       13.7500000, 121.0600000, 'available', 1200, 3500),
  ('MRF Kumintang', 'Brgy. Kumintang Ibaba',  13.7650000, 121.0550000, 'full',      2000, 5800),
  ('MRF Pallocan',  'Brgy. Pallocan West',    13.7400000, 121.0700000, 'available', 1500, 4200),
  ('MRF Cuta',      'Brgy. Cuta',             13.7550000, 121.0650000, 'full',      3000, 7500)
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. mrf_reservations
-- -----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE public.reservation_status AS ENUM
    ('pending', 'won', 'lost', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.mrf_reservations (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id     UUID         NOT NULL REFERENCES public.mrf_facilities(id) ON DELETE CASCADE,
  buyer_id        UUID         NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  material        VARCHAR(100),
  weight_kg       NUMERIC(10, 2),
  bid_amount      NUMERIC(12, 2) NOT NULL CHECK (bid_amount > 0),
  status          public.reservation_status NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mrf_reservations_buyer    ON public.mrf_reservations(buyer_id);
CREATE INDEX IF NOT EXISTS idx_mrf_reservations_facility ON public.mrf_reservations(facility_id);
CREATE INDEX IF NOT EXISTS idx_mrf_reservations_status   ON public.mrf_reservations(status);

DROP TRIGGER IF EXISTS trg_mrf_reservations_updated_at ON public.mrf_reservations;
CREATE TRIGGER trg_mrf_reservations_updated_at
  BEFORE UPDATE ON public.mrf_reservations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.mrf_facilities  IS 'MRF facility locations with GPS coords and bidding price info.';
COMMENT ON TABLE public.mrf_reservations IS 'Buyer bids on full MRF facilities; status tracks bid lifecycle.';
