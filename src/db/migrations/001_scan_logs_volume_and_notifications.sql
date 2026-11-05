-- =============================================================================
-- Migration 001: scan_logs volume tracking + notifications table
--
-- Changes:
--   1. Add volume_liters column to scan_logs
--      Populated when a collector confirms a bin collection
--      (sourced from tiers.capacity_liters at confirmation time).
--
--   2. Create notifications table
--      Single table for all roles. user_id determines ownership;
--      the backend filters by the authenticated user.
--
-- Safe to re-run: all statements use IF NOT EXISTS / DO $$ guards.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. scan_logs — add volume_liters
-- -----------------------------------------------------------------------------

ALTER TABLE public.scan_logs
  ADD COLUMN IF NOT EXISTS volume_liters NUMERIC(10, 2)
    CHECK (volume_liters IS NULL OR volume_liters > 0);

COMMENT ON COLUMN public.scan_logs.volume_liters IS
  'Bin capacity in litres at time of collection, sourced from tiers.capacity_liters. '
  'NULL until the collector confirms collection.';

-- Index for fast totalling of volume per collector
CREATE INDEX IF NOT EXISTS idx_scan_logs_volume
  ON public.scan_logs(collected_by)
  WHERE volume_liters IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. notifications table
-- -----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE public.notification_type AS ENUM (
    -- Resident
    'reward',
    'pickup',
    'promo',
    -- MRF worker
    'scan',
    'mrf_alert',
    -- Collector
    'task',
    'schedule',
    'complete',
    'report',
    -- Buyer
    'mrf',
    'reserve',
    -- Shared
    'system'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID                       PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID                       NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type       public.notification_type   NOT NULL,
  title      VARCHAR(150)               NOT NULL,
  body       TEXT                       NOT NULL,
  is_read    BOOLEAN                    NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ                NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id    ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read  ON public.notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);

COMMENT ON TABLE public.notifications IS
  'Persistent notification store for all roles. '
  'Filter by user_id (via JWT) on read. Mark read via PUT /api/notifications/:id/read.';
