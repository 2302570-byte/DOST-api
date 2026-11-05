-- Run this in pgAdmin Query Tool
-- Database: dostbesmart_db

-- Step 1: Create action enum
DO $$ BEGIN
  CREATE TYPE public.account_action AS ENUM ('created', 'enabled', 'disabled', 'deleted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Step 2: Add deleted_at and deleted_by columns to users table
ALTER TABLE public.users 
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- Step 3: Create index on deleted_at
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON public.users(deleted_at) WHERE deleted_at IS NOT NULL;

-- Step 4: Create account_history table
CREATE TABLE IF NOT EXISTS public.account_history (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action          public.account_action NOT NULL,
  performed_by    UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  barangay_name   VARCHAR(150),
  captain_name    VARCHAR(100),
  cluster_name    VARCHAR(100),
  details         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Step 5: Create indexes
CREATE INDEX IF NOT EXISTS idx_account_history_user_id ON public.account_history(user_id);
CREATE INDEX IF NOT EXISTS idx_account_history_action ON public.account_history(action);
CREATE INDEX IF NOT EXISTS idx_account_history_created_at ON public.account_history(created_at DESC);

-- Done!
SELECT 'Migration completed successfully!' AS status;
