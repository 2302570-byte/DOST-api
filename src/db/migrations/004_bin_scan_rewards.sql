-- ─── Migration 004 — Bin Scan Rewards ────────────────────────────────────────
-- Adds ECO reward amounts to tiers and adds collection tracking to scan_logs.
-- Run after 003_tiers_and_cleanup.sql

-- 1. Add eco_reward column to tiers
--    Higher tier = larger bin = more ECO
ALTER TABLE public.tiers
  ADD COLUMN IF NOT EXISTS eco_reward INTEGER NOT NULL DEFAULT 0;

-- 2. Set default ECO rewards per tier
--    These can be updated by the admin at any time
UPDATE public.tiers SET eco_reward = 20  WHERE name = 'Tier 1';
UPDATE public.tiers SET eco_reward = 35  WHERE name = 'Tier 2';
UPDATE public.tiers SET eco_reward = 50  WHERE name = 'Tier 3';

-- 3. Add collection tracking columns to scan_logs
--    collected_by  — the collector user who confirmed the pickup
--    collected_at  — when the collector scanned
--    eco_awarded   — how much ECO was given to the reporter (from tier)
--    eco_tx_hash   — Hedera transaction hash
--    eco_tx_status — blockchain confirmation status
ALTER TABLE public.scan_logs
  ADD COLUMN IF NOT EXISTS collected_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS collected_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS eco_awarded   INTEGER,
  ADD COLUMN IF NOT EXISTS eco_tx_hash   TEXT,
  ADD COLUMN IF NOT EXISTS eco_tx_status TEXT DEFAULT 'pending'
    CHECK (eco_tx_status IN ('pending', 'confirmed', 'failed'));

-- 4. Index for fast lookup of pending collections
CREATE INDEX IF NOT EXISTS idx_scan_logs_collected_by
  ON public.scan_logs (collected_by);

CREATE INDEX IF NOT EXISTS idx_scan_logs_eco_tx_status
  ON public.scan_logs (eco_tx_status);
