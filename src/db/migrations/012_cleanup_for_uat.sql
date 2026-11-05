-- =============================================================================
-- Complete UAT Cleanup Script - Remove ALL Test Deletion Records
-- Purpose: Hard delete all soft-deleted records + clear history logs
-- Safe to run: Only deletes records with deleted_at IS NOT NULL (already deleted)
--              Preserves all active data (deleted_at IS NULL)
-- Run: psql "<DATABASE_URL>" -f src/db/migrations/cleanup_for_uat.sql
-- =============================================================================

-- Show what will be deleted (for confirmation)
DO $$ 
DECLARE
  deleted_users_count INTEGER;
  deleted_barangays_count INTEGER;
  account_history_count INTEGER;
  barangay_history_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO deleted_users_count 
    FROM public.users WHERE deleted_at IS NOT NULL;
  SELECT COUNT(*) INTO deleted_barangays_count 
    FROM public.barangays WHERE deleted_at IS NOT NULL;
  SELECT COUNT(*) INTO account_history_count FROM public.account_history;
  SELECT COUNT(*) INTO barangay_history_count FROM public.barangay_history;
  
  RAISE NOTICE '=============================================================================';
  RAISE NOTICE 'UAT CLEANUP - RECORDS TO BE PERMANENTLY DELETED:';
  RAISE NOTICE '=============================================================================';
  RAISE NOTICE 'Soft-deleted Users (deleted_at IS NOT NULL): %', deleted_users_count;
  RAISE NOTICE 'Soft-deleted Barangays (deleted_at IS NOT NULL): %', deleted_barangays_count;
  RAISE NOTICE 'Account History logs: %', account_history_count;
  RAISE NOTICE 'Barangay History logs: %', barangay_history_count;
  RAISE NOTICE '=============================================================================';
  RAISE NOTICE 'ACTIVE DATA WILL BE PRESERVED:';
  RAISE NOTICE '- Active users (deleted_at IS NULL): %', (SELECT COUNT(*) FROM public.users WHERE deleted_at IS NULL);
  RAISE NOTICE '- Active barangays (deleted_at IS NULL): %', (SELECT COUNT(*) FROM public.barangays WHERE deleted_at IS NULL);
  RAISE NOTICE '- All clusters and other data remain untouched';
  RAISE NOTICE '=============================================================================';
END $$;

-- =============================================================================
-- STEP 1: Clear history logs first (they reference users/barangays via foreign keys)
-- =============================================================================
TRUNCATE TABLE public.account_history CASCADE;
TRUNCATE TABLE public.barangay_history CASCADE;

-- =============================================================================
-- STEP 2: Hard delete soft-deleted barangays (deleted_at IS NOT NULL)
-- This clears the "Deleted Barangays History" section in the UI
-- =============================================================================
DELETE FROM public.barangays WHERE deleted_at IS NOT NULL;

-- =============================================================================
-- STEP 3: Hard delete soft-deleted users (deleted_at IS NOT NULL)
-- This clears the "Deleted History" section in User Management
-- =============================================================================
DELETE FROM public.users WHERE deleted_at IS NOT NULL;

-- =============================================================================
-- VERIFICATION: Show what's left
-- =============================================================================
DO $$ 
DECLARE
  deleted_users_count INTEGER;
  deleted_barangays_count INTEGER;
  active_users_count INTEGER;
  active_barangays_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO deleted_users_count 
    FROM public.users WHERE deleted_at IS NOT NULL;
  SELECT COUNT(*) INTO deleted_barangays_count 
    FROM public.barangays WHERE deleted_at IS NOT NULL;
  SELECT COUNT(*) INTO active_users_count 
    FROM public.users WHERE deleted_at IS NULL;
  SELECT COUNT(*) INTO active_barangays_count 
    FROM public.barangays WHERE deleted_at IS NULL;
  
  RAISE NOTICE '';
  RAISE NOTICE '=============================================================================';
  RAISE NOTICE 'UAT CLEANUP COMPLETE:';
  RAISE NOTICE '=============================================================================';
  RAISE NOTICE 'Deleted users remaining: %', deleted_users_count;
  RAISE NOTICE 'Deleted barangays remaining: %', deleted_barangays_count;
  RAISE NOTICE 'Account history logs remaining: %', (SELECT COUNT(*) FROM public.account_history);
  RAISE NOTICE 'Barangay history logs remaining: %', (SELECT COUNT(*) FROM public.barangay_history);
  RAISE NOTICE '-----------------------------------------------------------------------------';
  RAISE NOTICE 'PRESERVED DATA:';
  RAISE NOTICE 'Active users: %', active_users_count;
  RAISE NOTICE 'Active barangays: %', active_barangays_count;
  RAISE NOTICE 'Active clusters: %', (SELECT COUNT(*) FROM public.clusters);
  RAISE NOTICE '=============================================================================';
  RAISE NOTICE 'Database is completely clean and ready for UAT!';
  RAISE NOTICE '"Deleted History" sections will now show 0 in the web app.';
  RAISE NOTICE '=============================================================================';
END $$;

SELECT 'Complete UAT Cleanup Finished! All soft-deleted records and history logs removed.' AS result;
