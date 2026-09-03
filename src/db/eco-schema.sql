-- ─── ECO Token Schema ────────────────────────────────────────────────────────
-- Extends the existing users table. No duplicate users table.
-- The blockchain contract is the source of truth for balances;
-- these tables are the fast-read mirror and application logic layer.

-- Waste types with per-kg ECO rates (matches mobile app WASTE_TYPES)
CREATE TABLE IF NOT EXISTS waste_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label       VARCHAR(100) NOT NULL UNIQUE,  -- e.g. 'Recyclables'
  eco_per_kg  NUMERIC(10,2) NOT NULL CHECK (eco_per_kg > 0),
  icon        VARCHAR(100),                  -- Ionicons name for the mobile app
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Each waste drop-off by a resident at an MRF
CREATE TABLE IF NOT EXISTS waste_submissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id     UUID NOT NULL REFERENCES users(id),
  mrf_worker_id   UUID NOT NULL REFERENCES users(id),
  waste_type_id   UUID NOT NULL REFERENCES waste_types(id),
  weight_kg       NUMERIC(8,2) NOT NULL CHECK (weight_kg > 0),
  eco_awarded     INTEGER NOT NULL CHECK (eco_awarded > 0),
  tx_hash         TEXT,
  tx_status       TEXT NOT NULL DEFAULT 'pending'
                  CHECK (tx_status IN ('pending', 'confirmed', 'failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waste_submissions_resident
  ON waste_submissions (resident_id);
CREATE INDEX IF NOT EXISTS idx_waste_submissions_worker
  ON waste_submissions (mrf_worker_id);
CREATE INDEX IF NOT EXISTS idx_waste_submissions_status
  ON waste_submissions (tx_status);

-- Rewards catalog
CREATE TABLE IF NOT EXISTS eco_rewards (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(200) NOT NULL,
  description  TEXT,
  category     VARCHAR(100),               -- 'Food', 'Shopping', 'Services', 'Utilities'
  partner      VARCHAR(100),
  eco_cost     INTEGER NOT NULL CHECK (eco_cost > 0),
  stock        INTEGER,                    -- NULL = unlimited
  featured     BOOLEAN NOT NULL DEFAULT false,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reward redemptions by residents
CREATE TABLE IF NOT EXISTS eco_redemptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id UUID NOT NULL REFERENCES users(id),
  reward_id   UUID NOT NULL REFERENCES eco_rewards(id),
  eco_cost    INTEGER NOT NULL,
  tx_hash     TEXT,
  tx_status   TEXT NOT NULL DEFAULT 'pending'
              CHECK (tx_status IN ('pending', 'confirmed', 'failed')),
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eco_redemptions_resident
  ON eco_redemptions (resident_id);

-- Fast-read cached ECO balance per user
-- Kept in sync after each confirmed tx; chain is source of truth.
CREATE TABLE IF NOT EXISTS user_eco_balances (
  user_id    UUID PRIMARY KEY REFERENCES users(id),
  balance    BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Seed waste types (matches mobile app WASTE_TYPES) ────────────────────────
INSERT INTO waste_types (label, eco_per_kg, icon) VALUES
  ('Recyclables',   20, 'refresh-circle-outline'),
  ('Biodegradable', 18, 'leaf-outline'),
  ('Special Waste', 50, 'warning-outline')
ON CONFLICT (label) DO NOTHING;

-- ─── Seed eco rewards (matches mock/data.js mockRewards) ─────────────────────
INSERT INTO eco_rewards (name, category, partner, eco_cost, stock, featured, is_active) VALUES
  ('Mercury Drug ₱100 Voucher',   'Services',  'Mercury Drug',       400, 5,  true,  true),
  ('Jollibee ₱50 GC',             'Food',      'Jollibee',           200, 12, false, true),
  ('SM Malls ₱100 GC',            'Shopping',  'SM Malls',           350, 8,  false, true),
  ('Meralco Bill Discount',       'Utilities', 'Meralco',            500, 3,  false, true),
  ('Chowking ₱50 GC',             'Food',      'Chowking',           180, 20, false, true),
  ('National Bookstore ₱75 GC',   'Shopping',  'National Bookstore', 250, 0,  false, false)
ON CONFLICT DO NOTHING;
