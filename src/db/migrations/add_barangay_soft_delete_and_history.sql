-- =============================================================================
-- Migration: Add Soft Delete and History Tracking to Barangays
-- Adds: deleted_at, deleted_by columns to barangays table
-- Creates: barangay_history table for audit trail
-- Run: psql "<DATABASE_URL>" -f src/db/migrations/add_barangay_soft_delete_and_history.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Add soft delete columns to barangays table
-- ---------------------------------------------------------------------------
ALTER TABLE public.barangays 
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_barangays_deleted_at ON public.barangays(deleted_at);

-- ---------------------------------------------------------------------------
-- barangay_history
-- Tracks lifecycle events: created, updated, deleted
-- Stores snapshot of barangay state at time of event
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.barangay_history (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  barangay_id     UUID          NOT NULL REFERENCES public.barangays(id) ON DELETE CASCADE,
  action          VARCHAR(20)   NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  -- Snapshot of barangay data at time of action
  snapshot        JSONB         NOT NULL,
  -- Who performed the action
  performed_by    UUID          REFERENCES public.users(id) ON DELETE SET NULL,
  performed_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_barangay_history_barangay_id ON public.barangay_history(barangay_id);
CREATE INDEX IF NOT EXISTS idx_barangay_history_action ON public.barangay_history(action);
CREATE INDEX IF NOT EXISTS idx_barangay_history_performed_at ON public.barangay_history(performed_at DESC);

SELECT 'Migration complete: barangays soft delete and barangay_history table created.' AS result;
