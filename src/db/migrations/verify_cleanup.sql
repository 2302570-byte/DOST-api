-- =============================================================================
-- Verification Script - Check Database State After Complete Cleanup
-- Run via pgAdmin Query Tool, psql, or:
--   node src/db/migrations/run-migration.js verify_cleanup.sql
-- =============================================================================

DO $$
BEGIN
  RAISE NOTICE '=============================================================================';
  RAISE NOTICE 'DATABASE CLEANUP VERIFICATION';
  RAISE NOTICE '=============================================================================';
END $$;

-- History tables (should be empty after cleanup)
SELECT
  '📜 Account History' AS category,
  COUNT(*) AS total,
  CASE
    WHEN COUNT(*) = 0 THEN '✅ CLEAN'
    ELSE '⚠️  HAS RECORDS'
  END AS status
FROM public.account_history;

SELECT
  '📜 Barangay History' AS category,
  COUNT(*) AS total,
  CASE
    WHEN COUNT(*) = 0 THEN '✅ CLEAN'
    ELSE '⚠️  HAS RECORDS'
  END AS status
FROM public.barangay_history;

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=============================================================================';
  RAISE NOTICE 'SOFT-DELETED RECORDS (should be 0 after cleanup):';
  RAISE NOTICE '=============================================================================';
END $$;

-- Soft-deleted users
SELECT
  '🗑️  Deleted Users' AS category,
  COUNT(*) AS total,
  CASE
    WHEN COUNT(*) = 0 THEN '✅ CLEAN'
    ELSE '⚠️  STILL EXISTS'
  END AS status
FROM public.users WHERE deleted_at IS NOT NULL;

-- Soft-deleted barangays
SELECT
  '🗑️  Deleted Barangays' AS category,
  COUNT(*) AS total,
  CASE
    WHEN COUNT(*) = 0 THEN '✅ CLEAN'
    ELSE '⚠️  STILL EXISTS'
  END AS status
FROM public.barangays WHERE deleted_at IS NOT NULL;

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=============================================================================';
  RAISE NOTICE 'ACTIVE DATA (should be PRESERVED):';
  RAISE NOTICE '=============================================================================';
END $$;

-- Active users by role
SELECT
  '👤 Active Users' AS category,
  COUNT(*) FILTER (WHERE role = 'super_admin')      AS super_admins,
  COUNT(*) FILTER (WHERE role = 'punong_barangay')  AS punong_barangay,
  COUNT(*) FILTER (WHERE role = 'collector_admin')  AS collector_admins,
  COUNT(*) AS total
FROM public.users WHERE deleted_at IS NULL;

-- Active barangays
SELECT
  '🏘️  Active Barangays' AS category,
  COUNT(*) AS total
FROM public.barangays WHERE deleted_at IS NULL;

-- Clusters
SELECT
  '🗂️  Clusters' AS category,
  COUNT(*) AS total
FROM public.clusters;

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=============================================================================';
  RAISE NOTICE 'EXPECTED STATE AFTER COMPLETE CLEANUP:';
  RAISE NOTICE '=============================================================================';
  RAISE NOTICE '✅ Account History:    0 (cleaned)';
  RAISE NOTICE '✅ Barangay History:   0 (cleaned)';
  RAISE NOTICE '✅ Deleted Users:      0 (hard deleted)';
  RAISE NOTICE '✅ Deleted Barangays:  0 (hard deleted)';
  RAISE NOTICE '✅ Active users:       PRESERVED (unchanged)';
  RAISE NOTICE '✅ Active barangays:   PRESERVED (unchanged)';
  RAISE NOTICE '✅ Clusters:           PRESERVED (unchanged)';
  RAISE NOTICE '=============================================================================';
END $$;
