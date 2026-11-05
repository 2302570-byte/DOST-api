# Migration Instructions - Reward Deletion Fix

## Issue
Rewards with existing redemptions cannot be deleted due to foreign key constraint violation.

## Solution
Add `ON DELETE CASCADE` to the `eco_redemptions.reward_id` foreign key constraint.

## Steps to Apply

### 1. Run the SQL Migration

Open your PostgreSQL client (pgAdmin, psql, etc.) and connect to `dostbesmart_db`, then run:

```sql
BEGIN;

-- Drop the existing foreign key constraint
ALTER TABLE public.eco_redemptions
  DROP CONSTRAINT IF EXISTS eco_redemptions_reward_id_fkey;

-- Recreate with ON DELETE CASCADE
ALTER TABLE public.eco_redemptions
  ADD CONSTRAINT eco_redemptions_reward_id_fkey
    FOREIGN KEY (reward_id)
    REFERENCES public.eco_rewards(id)
    ON DELETE CASCADE;

COMMIT;
```

**What this does:**
- When you delete a reward, all its redemption records are automatically deleted
- This is safe because redemption history is tied to the reward - if the reward is gone, those redemptions are historical data that should also be removed

### 2. Restart Backend Server

After running the migration:

```bash
cd DOST-api
npm start
```

### 3. Test the Fix

Try deleting the "Chowking ₱50 GC" reward (or any reward with redemptions) - it should now work without errors.

## Other Changes Made

### Login Error Message
- Changed "Invalid email or password" → "Account does not exist" when the email is not found
- Password mismatch still shows "Invalid email or password"
- This gives clearer feedback to users

### Barangay Deletion Cascade
- When a barangay is deleted in Barangay Management, all user accounts in that barangay are also deleted
- This includes Punong Barangay admins and residents
- Deleted users will no longer be able to log in (JWT will fail authentication because user doesn't exist)

## Files Modified

1. `DOST-api/src/db/schema.sql` - Updated `eco_redemptions` FK definition
2. `DOST-api/src/db/migrations/fix_eco_rewards_cascade.sql` - New migration file
3. `DOST-api/src/controllers/auth.controller.js` - Better error message when account doesn't exist
4. `DOST-api/src/routes/superAdmin.routes.js` - Cascade delete users when barangay is deleted

## For Your Team

When your team pulls these changes:

1. **Backend**: Run the migration SQL above, then `npm start`
2. **Frontend**: Just `npm start` (no changes needed)
3. **No npm install needed** - no new dependencies added
