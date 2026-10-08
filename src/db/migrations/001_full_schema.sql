-- ============================================================
-- BE-SMART Full Database Schema — dostbesmart_db
-- Single consolidated migration (replaces 003–009)
-- Run once on a fresh database, or use schema.sql directly.
-- ============================================================


-- ── Helpers ───────────────────────────────────────────────────────────────────

-- Auto-update updated_at on any table that has one
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


-- ── Enums ─────────────────────────────────────────────────────────────────────

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


-- ── users ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.users (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  phone         VARCHAR(20),
  password_hash TEXT         NOT NULL,
  role          user_role    NOT NULL,
  barangay      VARCHAR(150),
  address       TEXT,
  is_active     BOOLEAN      NOT NULL DEFAULT true,
  eco_points    INTEGER      NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_role  ON public.users(role);

DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ── tiers ─────────────────────────────────────────────────────────────────────
-- 4 standard volumetric tiers:
--   Tier 1 — Small   : 240L   (Household / Street Wheelie Bin)
--   Tier 2 — Medium  : 660L   (Barangay Drop-Off Container)
--   Tier 3 — Large   : 1100L  (Heavy-Duty Roll-Out Bin)
--   Tier 4 — Bulk    : NULL   (MRF Bay / Open Dumpster)

CREATE TABLE IF NOT EXISTS public.tiers (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(50)  NOT NULL UNIQUE,
  bin_category     VARCHAR(100),
  capacity_liters  INTEGER,
  typical_use      VARCHAR(200),
  eco_reward       INTEGER      NOT NULL DEFAULT 10,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_tiers_updated_at ON public.tiers;
CREATE TRIGGER trg_tiers_updated_at
  BEFORE UPDATE ON public.tiers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.tiers (name, bin_category, capacity_liters, typical_use, eco_reward) VALUES
  ('Tier 1 — Small',  'Household / Street Wheelie Bin', 240,  'Residential street corners',       10),
  ('Tier 2 — Medium', 'Barangay Drop-Off Container',    660,  'High-density barangay zones',      25),
  ('Tier 3 — Large',  'Heavy-Duty Roll-Out Bin',        1100, 'Public markets, schools, plazas',  40),
  ('Tier 4 — Bulk',   'MRF Bay / Open Dumpster Spot',   NULL, 'Barangay MRF consolidation points',60)
ON CONFLICT (name) DO NOTHING;


-- ── bins ──────────────────────────────────────────────────────────────────────
-- Status lifecycle: EMPTY → NOT_FULL → FULL → QUEUED → COLLECTED
--                                              PENDING (missed collection)

CREATE TABLE IF NOT EXISTS public.bins (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name               VARCHAR(150) NOT NULL,
  street             VARCHAR(200),
  barangay           VARCHAR(150),
  barangay_code      VARCHAR(50),
  cluster_id         VARCHAR(50),
  tier_id            UUID         REFERENCES public.tiers(id) ON DELETE SET NULL,
  sticker_dimensions VARCHAR(30)  DEFAULT '15cm x 15cm',
  latitude           NUMERIC(10,7),
  longitude          NUMERIC(10,7),
  status             VARCHAR(20)  NOT NULL DEFAULT 'EMPTY',
  is_depot           BOOLEAN      NOT NULL DEFAULT false,
  road_type          VARCHAR(20)  NOT NULL DEFAULT 'main_road'
                       CHECK (road_type IN ('highway', 'main_road', 'narrow_street')),
  allowed_truck_types JSONB       DEFAULT NULL,
  fill_photo_url     TEXT,
  qr_payload         TEXT,
  created_by         UUID         REFERENCES public.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT bins_status_check
    CHECK (status IN ('EMPTY', 'FULL', 'QUEUED', 'PENDING', 'COLLECTED'))
);

-- Only one depot row is allowed
CREATE UNIQUE INDEX IF NOT EXISTS idx_bins_single_depot
  ON public.bins (is_depot) WHERE is_depot = true;

CREATE INDEX IF NOT EXISTS idx_bins_barangay ON public.bins(barangay);
CREATE INDEX IF NOT EXISTS idx_bins_status   ON public.bins(status);
CREATE INDEX IF NOT EXISTS idx_bins_tier_id  ON public.bins(tier_id);

DROP TRIGGER IF EXISTS trg_bins_updated_at ON public.bins;
CREATE TRIGGER trg_bins_updated_at
  BEFORE UPDATE ON public.bins
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ── scan_logs ─────────────────────────────────────────────────────────────────
-- One row per resident QR scan. Updated by the collector on pickup.

CREATE TABLE IF NOT EXISTS public.scan_logs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  bin_id         UUID        NOT NULL REFERENCES public.bins(id)  ON DELETE CASCADE,
  reporter_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  photo_url      TEXT,
  latitude       NUMERIC(10,7),
  longitude      NUMERIC(10,7),
  notes          TEXT,
  scanned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Collector fields (filled when bin is confirmed collected)
  collected_by   UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  collected_at   TIMESTAMPTZ,
  eco_awarded    INTEGER,
  eco_tx_hash    TEXT,
  eco_tx_status  TEXT DEFAULT 'pending'
    CHECK (eco_tx_status IN ('pending', 'confirmed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_scan_logs_bin_id        ON public.scan_logs(bin_id);
CREATE INDEX IF NOT EXISTS idx_scan_logs_reporter      ON public.scan_logs(reporter_id);
CREATE INDEX IF NOT EXISTS idx_scan_logs_collected_by  ON public.scan_logs(collected_by);
CREATE INDEX IF NOT EXISTS idx_scan_logs_eco_tx_status ON public.scan_logs(eco_tx_status);


-- ── trucks ────────────────────────────────────────────────────────────────────
-- Three types: 10_wheeler (12000L), forward_truck (7000L), mini_dump_truck (3500L)
-- max_capacity is used by the OR-Tools CVRP route optimizer.

CREATE TABLE IF NOT EXISTS public.trucks (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_number          VARCHAR(20) NOT NULL UNIQUE,
  name                  VARCHAR(100) NOT NULL,
  truck_type            VARCHAR(50) NOT NULL DEFAULT 'forward_truck'
                          CHECK (truck_type IN ('10_wheeler', 'forward_truck', 'mini_dump_truck')),
  max_capacity          INTEGER     NOT NULL DEFAULT 7000,
  status                VARCHAR(20) NOT NULL DEFAULT 'idle'
                          CHECK (status IN ('idle', 'en_route', 'at_depot', 'maintenance', 'inactive')),

  -- Live GPS (updated by mobile app)
  latitude              NUMERIC(10,7),
  longitude             NUMERIC(10,7),
  last_seen_at          TIMESTAMPTZ,

  -- Assignment
  assigned_collector_id UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  cluster_id            VARCHAR(50),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trucks_status       ON public.trucks(status);
CREATE INDEX IF NOT EXISTS idx_trucks_collector_id ON public.trucks(assigned_collector_id);

DROP TRIGGER IF EXISTS trg_trucks_updated_at ON public.trucks;
CREATE TRIGGER trg_trucks_updated_at
  BEFORE UPDATE ON public.trucks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
