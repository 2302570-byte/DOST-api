-- BE-SMART Full Database Schema - dostbesmart_db
-- Run this to set up a fresh database from scratch

-- Custom types
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM (
    'super_admin',
    'cluster_admin',
    'collector_admin',
    'punong_barangay',
    'resident',
    'mrf_worker',
    'mrf_buyer',
    'collector'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- users
CREATE TABLE IF NOT EXISTS public.users (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(100)  NOT NULL,
  email         VARCHAR(150)  NOT NULL UNIQUE,
  phone         VARCHAR(20),
  password_hash TEXT          NOT NULL,
  role          user_role     NOT NULL,
  barangay      VARCHAR(150),
  address       TEXT,
  is_active     BOOLEAN       NOT NULL DEFAULT true,
  eco_points    INTEGER       NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- tiers
CREATE TABLE IF NOT EXISTS public.tiers (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(50)  NOT NULL,
  capacity_liters  INTEGER,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Default tier seeds
INSERT INTO public.tiers (name, capacity_liters) SELECT 'Tier 1', 660  WHERE NOT EXISTS (SELECT 1 FROM public.tiers WHERE name = 'Tier 1');
INSERT INTO public.tiers (name, capacity_liters) SELECT 'Tier 2', 1100 WHERE NOT EXISTS (SELECT 1 FROM public.tiers WHERE name = 'Tier 2');
INSERT INTO public.tiers (name, capacity_liters) SELECT 'Tier 3', NULL WHERE NOT EXISTS (SELECT 1 FROM public.tiers WHERE name = 'Tier 3');


CREATE TABLE IF NOT EXISTS public.bins (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   VARCHAR(150) NOT NULL,
  street                 VARCHAR(200),
  barangay               VARCHAR(150),
  barangay_code          VARCHAR(50),
  cluster_id             VARCHAR(50),
  tier_id                UUID REFERENCES public.tiers(id) ON DELETE SET NULL,
  sticker_dimensions     VARCHAR(30)  DEFAULT '15cm x 15cm',
  latitude               NUMERIC(10, 7),
  longitude              NUMERIC(10, 7),
  status                 VARCHAR(20)  NOT NULL DEFAULT 'EMPTY',
  fill_photo_url         TEXT,
  qr_payload             TEXT,
  created_by             UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT bins_status_check
    CHECK (status IN ('EMPTY', 'PARTIAL', 'FULL', 'COLLECTED', 'LOCKED', 'MISSED'))
);

-- scan_logs
CREATE TABLE IF NOT EXISTS public.scan_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  bin_id      UUID        NOT NULL REFERENCES public.bins(id) ON DELETE CASCADE,
  reporter_id UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  photo_url   TEXT,
  latitude    NUMERIC(10, 7),
  longitude   NUMERIC(10, 7),
  notes       TEXT,
  scanned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email        ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_role         ON public.users(role);
CREATE INDEX IF NOT EXISTS idx_bins_barangay      ON public.bins(barangay);
CREATE INDEX IF NOT EXISTS idx_bins_status        ON public.bins(status);
CREATE INDEX IF NOT EXISTS idx_bins_tier_id       ON public.bins(tier_id);
CREATE INDEX IF NOT EXISTS idx_scan_logs_bin_id   ON public.scan_logs(bin_id);
CREATE INDEX IF NOT EXISTS idx_scan_logs_reporter ON public.scan_logs(reporter_id);

-- Auto updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tiers_updated_at ON public.tiers;
CREATE TRIGGER trg_tiers_updated_at
  BEFORE UPDATE ON public.tiers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_bins_updated_at ON public.bins;
CREATE TRIGGER trg_bins_updated_at
  BEFORE UPDATE ON public.bins
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
