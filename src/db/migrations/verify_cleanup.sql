-- =============================================================================
-- Verification Script - Check Database State After Complete Cleanup
-- Run: psql "<DATABASE_URL>" -f src/db/migrations/verify_cleanup.sql
-- =============================================================================

\echo '============================================================================='
\echo 'DATABASE CLEANUP VERIFICATION'
\echo '============================================================================='

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

\echo ''
\echo '============================================================================='
\echo 'SOFT-DELETED RECORDS (should be 0 after cleanup):'
\echo '============================================================================='

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

\echo ''
\echo '============================================================================='
\echo 'ACTIVE DATA (should be PRESERVED):'
\echo '============================================================================='

-- Active users
SELECT 
  '👤 Active Users' AS category,
  COUNT(*) FILTER (WHERE role = 'super_admin') AS super_admins,
  COUNT(*) FILTER (WHERE role = 'punong_barangay') AS punong_barangay,
  COUNT(*) FILTER (WHERE role = 'collector_admin') AS collector_admins,
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

\echo ''
\echo '============================================================================='
\echo 'EXPECTED STATE AFTER COMPLETE CLEANUP:'
\echo '============================================================================='
\echo '✅ Account History: 0 (cleaned)'
\echo '✅ Barangay History: 0 (cleaned)'
\echo '✅ Deleted Users: 0 (hard deleted)'
\echo '✅ Deleted Barangays: 0 (hard deleted)'
\echo '✅ Active users: PRESERVED (unchanged)'
\echo '✅ Active barangays: PRESERVED (unchanged)'
\echo '✅ Clusters: PRESERVED (unchanged)'
\echo '============================================================================='
