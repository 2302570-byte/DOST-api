-- =============================================================================
-- Cleanup Script: Mark Orphaned Accounts as Unassigned
-- Finds accounts with barangays that don't exist and marks them as unassigned
-- Run: Copy this SQL and execute in pgAdmin Query Tool
-- =============================================================================

-- Mark all users whose barangay doesn't exist in barangays table as unassigned
UPDATE public.users
SET 
  barangay = NULL,
  is_active = false,
  updated_at = NOW()
WHERE role = 'punong_barangay'
  AND barangay IS NOT NULL
  AND barangay NOT IN (
    SELECT name 
    FROM public.barangays 
    WHERE deleted_at IS NULL
  );

-- Show results
SELECT 
  id,
  name AS captain,
  email,
  barangay AS old_barangay,
  is_active,
  'Now Unassigned' AS status
FROM public.users
WHERE role = 'punong_barangay'
  AND barangay IS NULL
  AND is_active = false;

SELECT 'Cleanup complete: Orphaned accounts marked as Unassigned.' AS result;
