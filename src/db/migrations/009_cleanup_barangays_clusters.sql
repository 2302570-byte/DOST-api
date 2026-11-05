-- =============================================================================
-- Cleanup Script: Reset Barangays and Clusters to Zero State
-- Purpose: Wipe all existing barangay and cluster records for clean slate
-- Run: psql "<DATABASE_URL>" -f src/db/migrations/cleanup_barangays_clusters.sql
-- =============================================================================

BEGIN;

-- Step 1: Remove all cluster-barangay assignments
DELETE FROM public.cluster_barangays;

-- Step 2: Remove all clusters
DELETE FROM public.clusters;

-- Step 3: Remove all barangays
DELETE FROM public.barangays;

-- Step 4: Reset auto-increment sequences (if any)
-- Note: We use UUIDs, so no sequences to reset

-- Step 5: Verify clean state
SELECT 'Cleanup complete. Verification:' AS status;
SELECT 'Barangays remaining: ' || COUNT(*)::text FROM public.barangays;
SELECT 'Clusters remaining: ' || COUNT(*)::text FROM public.clusters;
SELECT 'Cluster-Barangay links remaining: ' || COUNT(*)::text FROM public.cluster_barangays;

COMMIT;

SELECT '✓ Database reset to zero state. Super Admin can now create barangays dynamically.' AS result;
