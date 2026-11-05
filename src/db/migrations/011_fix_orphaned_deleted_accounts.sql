-- fix_orphaned_deleted_accounts.sql
-- ────────────────────────────────────────────────────────────────────────────
-- Purpose: Retroactively create history records for accounts deleted before
--          the soft-delete feature was implemented, so they show proper
--          barangay names in the deleted accounts history view.
--
-- Problem: Accounts deleted before account_history table existed have
--          deleted_at IS NOT NULL but no corresponding history record,
--          causing "N/A" to appear in the UI.
--
-- Solution: For each deleted account without a history record, attempt to
--           reconstruct the barangay name from the account's barangay field
--           and create a retroactive history entry.
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Create history records for deleted accounts that have barangay names but no history
INSERT INTO public.account_history (
  user_id,
  action,
  barangay_name,
  cluster_name,
  performed_by,
  created_at
)
SELECT
  u.id,
  'deleted'::public.account_action,
  u.barangay,
  c.name,
  u.deleted_by,
  u.deleted_at
FROM public.users u
LEFT JOIN public.barangays b ON b.name = u.barangay AND b.deleted_at IS NULL
LEFT JOIN public.cluster_barangays cb ON cb.barangay_id = b.id
LEFT JOIN public.clusters c ON c.id = cb.cluster_id
WHERE u.role = 'punong_barangay'
  AND u.deleted_at IS NOT NULL
  AND u.barangay IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.account_history h
    WHERE h.user_id = u.id AND h.action = 'deleted'
  );

-- Step 2: Mark orphaned deleted accounts (barangay was hard-deleted before soft-delete)
--         with a special note in their barangay_name history
INSERT INTO public.account_history (
  user_id,
  action,
  barangay_name,
  cluster_name,
  performed_by,
  created_at
)
SELECT
  u.id,
  'deleted'::public.account_action,
  COALESCE(u.barangay, 'Deleted Barangay (no record)'),
  'No Cluster',
  u.deleted_by,
  u.deleted_at
FROM public.users u
WHERE u.role = 'punong_barangay'
  AND u.deleted_at IS NOT NULL
  AND (u.barangay IS NULL OR u.barangay NOT IN (
    SELECT name FROM public.barangays WHERE deleted_at IS NULL
  ))
  AND NOT EXISTS (
    SELECT 1
    FROM public.account_history h
    WHERE h.user_id = u.id AND h.action = 'deleted'
  );

-- Step 3: Display summary
SELECT 
  'Orphaned deleted accounts fixed:' AS message,
  COUNT(*) AS count
FROM public.users u
WHERE u.role = 'punong_barangay'
  AND u.deleted_at IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.account_history h
    WHERE h.user_id = u.id AND h.action = 'deleted'
  );
