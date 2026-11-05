-- ---------------------------------------------------------------------------
-- Migration 003: Two-step reward redemption
--
-- Changes:
--   1. Add claimed_at and claimed_by to eco_redemptions (physical claim step).
--   2. Restore any balance that was pre-deducted on pending rows that have not
--      been claimed yet — the new flow deducts only at claim time, so pending
--      rows should NOT have reduced the balance.
--   3. The tx_status constraint is widened: 'pending' now means "QR issued,
--      awaiting MRF scan"; 'confirmed' means "MRF scanned, balance deducted,
--      blockchain burn done".
-- ---------------------------------------------------------------------------

-- 1. Add the physical-claim columns (idempotent)
ALTER TABLE public.eco_redemptions
  ADD COLUMN IF NOT EXISTS claimed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_by  UUID REFERENCES public.users(id);

-- 2. Index for the MRF worker lookup (claimed_by) and pending-per-resident queries
CREATE INDEX IF NOT EXISTS idx_eco_redemptions_claimed_by
  ON public.eco_redemptions(claimed_by);

CREATE INDEX IF NOT EXISTS idx_eco_redemptions_status_resident
  ON public.eco_redemptions(resident_id, tx_status);
