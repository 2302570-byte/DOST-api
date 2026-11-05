-- =============================================================================
-- Account History Migration
-- Tracks lifecycle events for Punong Barangay accounts (created, disabled, enabled, deleted)
-- =============================================================================

-- Create action enum
DO $$ BEGIN
  CREATE TYPE public.account_action AS ENUM (
    'created',
    'enabled',
    'disabled',
    'deleted'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create account_history table
CREATE TABLE IF NOT EXISTS public.account_history (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action          public.account_action NOT NULL,
  performed_by    UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  barangay_name   VARCHAR(150),  -- Snapshot of barangay at time of action
  captain_name    VARCHAR(100),  -- Snapshot of captain name at time of action
  cluster_name    VARCHAR(100),  -- Snapshot of cluster at time of action
  details         TEXT,          -- Optional additional context
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_history_user_id ON public.account_history(user_id);
CREATE INDEX IF NOT EXISTS idx_account_history_action ON public.account_history(action);
CREATE INDEX IF NOT EXISTS idx_account_history_created_at ON public.account_history(created_at DESC);

-- Add soft delete support to users table (keep deleted records for history)
ALTER TABLE public.users 
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON public.users(deleted_at) WHERE deleted_at IS NOT NULL;

COMMENT ON TABLE public.account_history IS 'Tracks lifecycle events for Punong Barangay accounts';
COMMENT ON COLUMN public.account_history.barangay_name IS 'Snapshot of barangay name at time of action';
COMMENT ON COLUMN public.account_history.cluster_name IS 'Snapshot of cluster assignment at time of action';
COMMENT ON COLUMN public.users.deleted_at IS 'Soft delete timestamp - NULL means active, non-NULL means deleted';
