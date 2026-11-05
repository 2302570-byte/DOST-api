-- =============================================================================
-- Migration: Add ON DELETE CASCADE to eco_redemptions.reward_id FK
-- =============================================================================
-- Problem: Rewards with existing redemptions cannot be deleted
-- Solution: Drop and recreate FK with CASCADE behavior
-- =============================================================================

BEGIN;

-- Drop the existing foreign key constraint
ALTER TABLE public.eco_redemptions
  DROP CONSTRAINT IF EXISTS eco_redemptions_reward_id_fkey;

-- Recreate with ON DELETE CASCADE
-- When a reward is deleted, all its redemption records are also deleted
ALTER TABLE public.eco_redemptions
  ADD CONSTRAINT eco_redemptions_reward_id_fkey
    FOREIGN KEY (reward_id)
    REFERENCES public.eco_rewards(id)
    ON DELETE CASCADE;

COMMIT;

-- Verification query (optional - run manually to check):
-- SELECT conname, confdeltype FROM pg_constraint WHERE conname = 'eco_redemptions_reward_id_fkey';
-- confdeltype should be 'c' (cascade)
