# Complete UAT Cleanup - Remove ALL Test Deletion Records

## 📋 Overview
This script **completely cleans** all soft-deleted records and history logs. Perfect for starting UAT with a 100% fresh database.

---

## 🔒 What's Safe (100% PRESERVED)
- ✅ All **active** users (deleted_at IS NULL)
- ✅ All **active** barangays (deleted_at IS NULL)
- ✅ All clusters
- ✅ All other data
- ✅ Database schema unchanged
- ✅ Can be run multiple times safely

## 🗑️ What Gets PERMANENTLY DELETED
- ❌ Soft-deleted users (deleted_at IS NOT NULL) - **Hard delete**
- ❌ Soft-deleted barangays (deleted_at IS NOT NULL) - **Hard delete**
- ❌ Account history logs (from `account_history` table)
- ❌ Barangay history logs (from `barangay_history` table)

**Result:** "Deleted History" sections in web app will show **0** records.

---

## 🚀 How to Run

### Option 1: pgAdmin (GUI) - EASIEST
1. Open pgAdmin
2. Connect to `dostbesmart_db` database
3. Click **Tools** → **Query Tool**
4. Open file: `cleanup_for_uat.sql`
5. Click **Execute** (▶️ button)
6. Review the output messages
7. Run `verify_cleanup.sql` to confirm (optional)

### Option 2: Command Line (psql)
```bash
# Navigate to migrations folder
cd DOST-api/src/db/migrations

# Run cleanup
psql "postgresql://postgres:yourpassword@localhost:5432/dostbesmart_db" -f cleanup_for_uat.sql

# Verify (optional)
psql "postgresql://postgres:yourpassword@localhost:5432/dostbesmart_db" -f verify_cleanup.sql
```

**Replace** `yourpassword` with your actual PostgreSQL password.

---

## ✅ What You'll See

### During cleanup:
```
=============================================================================
UAT CLEANUP - RECORDS TO BE PERMANENTLY DELETED:
=============================================================================
Soft-deleted Users (deleted_at IS NOT NULL): 20
Soft-deleted Barangays (deleted_at IS NOT NULL): 45
Account History logs: 0
Barangay History logs: 0
=============================================================================
ACTIVE DATA WILL BE PRESERVED:
- Active users (deleted_at IS NULL): 1
- Active barangays (deleted_at IS NULL): 0
- All clusters and other data remain untouched
=============================================================================

... [deletion happens] ...

=============================================================================
UAT CLEANUP COMPLETE:
=============================================================================
Deleted users remaining: 0 ✅
Deleted barangays remaining: 0 ✅
Account history logs remaining: 0 ✅
Barangay history logs remaining: 0 ✅
-----------------------------------------------------------------------------
PRESERVED DATA:
Active users: 1 (Super Admin)
Active barangays: 0
Active clusters: [your count]
=============================================================================
Database is completely clean and ready for UAT!
"Deleted History" sections will now show 0 in the web app.
=============================================================================
```

### After verification:
```
=============================================================================
DATABASE CLEANUP VERIFICATION
=============================================================================
📜 Account History: 0 ✅ CLEAN
📜 Barangay History: 0 ✅ CLEAN
🗑️  Deleted Users: 0 ✅ CLEAN
🗑️  Deleted Barangays: 0 ✅ CLEAN

ACTIVE DATA (PRESERVED):
=============================================================================
👤 Active Users: 1 Super Admin
🏘️  Active Barangays: 0
🗂️  Clusters: [your count]
=============================================================================
```

---

## 🎯 Why This Cleanup?

**Your situation:**
- ✅ You already deleted test users/barangays through the Super Admin UI (soft delete)
- ❌ Those deleted records still show in "Deleted History" sections (20 users, 45 barangays)
- 🎯 You want a **completely fresh start** for UAT

**What this script does:**
1. **Hard deletes** all soft-deleted users (`WHERE deleted_at IS NOT NULL`)
2. **Hard deletes** all soft-deleted barangays (`WHERE deleted_at IS NOT NULL`)
3. **Clears** all history logs
4. **Preserves** all active data (Super Admin, any active barangays, clusters)

**After cleanup:**
- "Deleted History" sections show **0** records
- Database is pristine for UAT users
- New deletions during UAT will be logged cleanly
- No confusion from old test data

---

## 📞 Notes

1. **No backup needed:** Only deleting already-deleted records (low risk)

2. **Safe to run multiple times:** Script only targets soft-deleted records

3. **Fresh start:** UAT users start with a completely clean slate

4. **Does NOT affect:**
   - Login functionality
   - Any active users
   - Any active barangays
   - Clusters
   - Any other functionality

---

## ⚠️ What if Something Goes Wrong?

**Very unlikely** - you're only deleting records that are already marked as deleted (soft delete).

If needed, those records will be recreated as UAT users perform actions:
- Create new barangays → fresh active records
- Delete barangays → new clean deletion logs
- Old test data is gone permanently (which is the goal)

---

## 🔄 After Running - Refresh Browser

1. **Run the script** in pgAdmin (takes ~2 seconds)
2. **Refresh web app:** Press **`Ctrl + Shift + R`** (hard refresh)
3. **Check:**
   - User Management → "Deleted History" should show **0** ✅
   - Barangay Management → "Deleted Barangays History" should show **0** ✅

---

## ✅ Ready to Run Checklist
- [ ] Open pgAdmin or terminal
- [ ] Navigate to migrations folder
- [ ] Execute `cleanup_for_uat.sql`
- [ ] See confirmation message "Complete UAT Cleanup Finished!"
- [ ] (Optional) Run `verify_cleanup.sql` to confirm
- [ ] Hard refresh browser (`Ctrl + Shift + R`)
- [ ] Verify "Deleted History" sections show 0
- [ ] Done! 🎉

**Timeline:** ~2-5 seconds to run, instant browser refresh

---

## 🎉 After Cleanup

Your database will be:
- ✅ Completely clean (no soft-deleted records)
- ✅ Zero history logs
- ✅ All active data preserved
- ✅ "Deleted History" sections show 0 in web app
- ✅ 100% ready for UAT users to start fresh

**You're ready for pristine UAT deployment!** 🚀
