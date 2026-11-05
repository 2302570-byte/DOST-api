# DOST System - Quick Deployment Steps

**For teammates updating to the latest UAT-ready version**

---

## 🚀 **Complete Step-by-Step Deployment**

### **STEP 1: Pull Latest Code**

Open terminal/command prompt:

```bash
# Navigate to API folder
cd path/to/DOST-api

# Pull latest changes
git pull origin main

# Install dependencies
npm install
```

Then do the same for web app:

```bash
# Navigate to Web App folder
cd path/to/DOST-web-app

# Pull latest changes
git pull origin main

# Install dependencies
npm install
```

---

---

### **STEP 2: Run Database Migrations in pgAdmin**

**⚠️ CRITICAL:** Run these **6 migrations IN ORDER** - each builds on the previous!

**How to run each migration:**
1. Open **pgAdmin**
2. Connect to your PostgreSQL server
3. Right-click on `dostbesmart_db` → **Tools** → **Query Tool**
4. Follow the steps below for each migration

---

#### **Migration 1: Super Admin Tables**
**File:** `add_super_admin_tables.sql`

1. In Query Tool, click **Open File** (📁 folder icon)
2. Navigate to `DOST-api/src/db/migrations/add_super_admin_tables.sql`
3. Click **Execute** (▶️ play button)
4. ✅ Should see: "Migration complete: barangays, collection_routes, notifications tables created"

**What it creates:** `barangays`, `collection_routes`, `notifications` tables

---

#### **Migration 2: Clusters**
**File:** `add_clusters.sql`

1. Click **Open File** (📁)
2. Navigate to `DOST-api/src/db/migrations/add_clusters.sql`
3. Click **Execute** (▶️)
4. ✅ Should see: "Migration complete: cluster and cluster_barangays tables created"

**What it creates:** `clusters` table and `cluster_barangays` junction table

---

#### **Migration 3: Collector Units**
**File:** `add_collector_units.sql`

1. Click **Open File** (📁)
2. Navigate to `DOST-api/src/db/migrations/add_collector_units.sql`
3. Click **Execute** (▶️)
4. ✅ Should see: Query completed successfully

**What it creates:** `collector_units` and `collector_unit_members` tables

---

#### **Migration 4: Account History & User Soft Delete**
**File:** `add_account_history.sql`

1. Click **Open File** (📁)
2. Navigate to `DOST-api/src/db/migrations/add_account_history.sql`
3. Click **Execute** (▶️)
4. ✅ Should see: Query completed successfully

**What it does:** 
- Adds `deleted_at` and `deleted_by` columns to `users` table
- Creates `account_history` table for audit logs

---

#### **Migration 5: Barangay Soft Delete & History**
**File:** `add_barangay_soft_delete_and_history.sql`

1. Click **Open File** (📁)
2. Navigate to `DOST-api/src/db/migrations/add_barangay_soft_delete_and_history.sql`
3. Click **Execute** (▶️)
4. ✅ Should see: "Migration complete: barangays soft delete and barangay_history table created"

**What it does:**
- Adds `deleted_at` and `deleted_by` columns to `barangays` table
- Creates `barangay_history` table for audit logs

---

#### **Migration 6: Fix ECO Rewards CASCADE**
**File:** `fix_eco_rewards_cascade.sql`

1. Click **Open File** (📁)
2. Navigate to `DOST-api/src/db/migrations/fix_eco_rewards_cascade.sql`
3. Click **Execute** (▶️)
4. ✅ Should see: Constraint updated successfully

**What it does:** Fixes foreign key constraint on `eco_redemptions` table

---

#### **✅ VERIFY ALL MIGRATIONS SUCCEEDED**

Copy-paste this query into Query Tool and execute:

```sql
SELECT 
  COUNT(*) FILTER (WHERE table_name = 'barangays') as has_barangays,
  COUNT(*) FILTER (WHERE table_name = 'clusters') as has_clusters,
  COUNT(*) FILTER (WHERE table_name = 'account_history') as has_account_history,
  COUNT(*) FILTER (WHERE table_name = 'barangay_history') as has_barangay_history,
  COUNT(*) FILTER (WHERE table_name = 'collector_units') as has_collector_units
FROM information_schema.tables 
WHERE table_schema = 'public';
```

**Expected result:** All columns should show **1** or higher ✅

If any show **0**, that migration failed - go back and run it again.

---

### **STEP 3: Restart Both Servers**

Stop your current servers (press `Ctrl+C` in both terminal windows), then restart:

**Terminal 1 - Backend:**
```bash
cd DOST-api
npm run dev
```

**Expected output:**
```
Server running on http://localhost:5000
Connected to PostgreSQL database: dostbesmart_db
```

**Terminal 2 - Frontend:**
```bash
cd DOST-web-app
npm run dev
```

**Expected output:**
```
VITE ready in XXX ms
➜  Local:   http://localhost:5173/
```

---

### **STEP 4: Test Everything Works**

#### **4.1. Test Login**
1. Open browser: `http://localhost:5173`
2. Login with Super Admin credentials
3. ✅ Should see dashboard

#### **4.2. Test Barangay Create/Delete**
1. Go to **Barangay Management**
2. Click **"Create First Barangay"** or **"Add Barangay"**
3. Enter:
   - Name: "Test Barangay"
   - Captain: "Test Captain"
   - Email: "test@example.com"
4. Click Save
5. ✅ Should see barangay in the table

6. Click **Actions** → **Delete** on that barangay
7. Confirm deletion
8. ✅ Barangay disappears from active list

9. Scroll down and expand **"Deleted Barangays History"** section
10. ✅ Should see "Test Barangay" with deletion timestamp and "Deleted By: Super Admin"

#### **4.3. Test User Create/Delete**
1. Go to **User Management**
2. Click **"Add Barangay Admin"**
3. Select the test barangay you created
4. Enter captain name, email, and temp password
5. Click Save
6. ✅ Should see user in the table

7. Click **Actions** → **Delete Account**
8. Confirm deletion
9. ✅ User disappears from active list

10. Click on **"Deleted History"** tab (shows count like "Deleted History 1")
11. ✅ Should see deleted user with timestamp

**If all these work:** ✅ **Your system is perfectly updated!**

---

### **STEP 5: Clean Test Data (Optional)**

After testing, clean up the test records:

**In pgAdmin Query Tool:**
1. Click **Open File** (📁)
2. Navigate to `DOST-api/src/db/migrations/cleanup_for_uat.sql`
3. Click **Execute** (▶️)
4. ✅ Should see: "Complete UAT Cleanup Finished!"

**In Browser:**
5. Hard refresh: Press `Ctrl + Shift + R`
6. Check User Management → "Deleted History" should show **0**
7. Check Barangay Management → "Deleted Barangays History" should show **0**

✅ **Database is now pristine and ready for UAT users!**

---

## ✅ **Done! That's it.**

Your system is now up to date with the UAT-ready version.

---

## 🔧 **If Something Goes Wrong**

### **Error: "column deleted_at does not exist"**
→ You missed running the migrations. Go back to Step 2.

### **Error: "relation account_history already exists"**
→ Migration already ran. Skip it and continue.

### **Error: "port 5000 already in use"**
→ Stop the old server first (Ctrl+C), then restart.

---

## 📋 **Quick Summary**

What you just updated:
- ✅ Soft delete for users and barangays (data preserved, not lost)
- ✅ History tracking (audit logs)
- ✅ Email/barangay name reuse (can recreate with same name)
- ✅ Dynamic dates (starts from 2026, not hardcoded)
- ✅ Better sorting and UI improvements

---

### **STEP 1: Pull Latest Code from GitHub**

#### **1.1. Navigate to DOST-api folder**
```bash
cd path/to/DOST-api
```

#### **1.2. Commit or stash your local changes** (if any)
```bash
# Check for uncommitted changes
git status

# Option A: Commit your changes
git add .
git commit -m "My local changes before pulling UAT"

# Option B: Stash your changes (if you want to keep them temporary)
git stash
```

#### **1.3. Pull latest changes from origin/main**
```bash
git pull origin main
```

**Expected output:**
```
Updating abc123..def456
Fast-forward
 src/routes/superAdmin.routes.js              | 150 ++++++++++++
 src/db/migrations/add_account_history.sql    | 45 ++++
 src/db/migrations/add_barangay_soft_delete_and_history.sql | 38 +++
 src/db/migrations/cleanup_for_uat.sql        | 92 +++++++
 ... (more files)
```

#### **1.4. Install any new dependencies** (if package.json changed)
```bash
npm install
```

---

### **STEP 2: Pull DOST-web-app Changes**

#### **2.1. Navigate to DOST-web-app folder**
```bash
cd path/to/DOST-web-app
```

#### **2.2. Commit or stash your local changes** (if any)
```bash
git status
git add .
git commit -m "My local changes before pulling UAT"
# or
git stash
```

#### **2.3. Pull latest changes**
```bash
git pull origin main
```

#### **2.4. Install any new dependencies**
```bash
npm install
```

---

### **STEP 3: Run Database Migrations (CRITICAL)**

⚠️ **IMPORTANT:** Your database needs to be updated with new tables and columns.

#### **3.1. Open pgAdmin**
1. Launch pgAdmin
2. Connect to your PostgreSQL server
3. Navigate to your database: `dostbesmart_db`

#### **3.2. Run migrations in ORDER** (very important!)

**Open Query Tool:** Right-click `dostbesmart_db` → **Tools** → **Query Tool**

---

#### **Migration 1: Account History & Soft Delete**
**File:** `DOST-api/src/db/migrations/add_account_history.sql`

**What it does:**
- Adds `deleted_at` and `deleted_by` columns to `users` table
- Creates `account_history` table for audit logs
- Creates `account_action` enum type

**Run in Query Tool:**
1. Click **Open File** (📁 icon)
2. Navigate to `DOST-api/src/db/migrations/add_account_history.sql`
3. Click **Execute** (▶️ button)

**Expected output:**
```
Query returned successfully in XXX msec.
```

---

#### **Migration 2: Barangay Soft Delete & History**
**File:** `DOST-api/src/db/migrations/add_barangay_soft_delete_and_history.sql`

**What it does:**
- Adds `deleted_at` and `deleted_by` columns to `barangays` table
- Creates `barangay_history` table for audit logs

**Run in Query Tool:**
1. Click **Open File** (📁 icon)
2. Navigate to `DOST-api/src/db/migrations/add_barangay_soft_delete_and_history.sql`
3. Click **Execute** (▶️ button)

**Expected output:**
```
Migration complete: barangays soft delete and barangay_history table created.
```

---

#### **3.3. Verify migrations succeeded**

Run this verification query in Query Tool:
```sql
-- Check if new columns exist
SELECT 
  column_name, 
  data_type 
FROM information_schema.columns 
WHERE table_name = 'users' 
  AND column_name IN ('deleted_at', 'deleted_by');

SELECT 
  column_name, 
  data_type 
FROM information_schema.columns 
WHERE table_name = 'barangays' 
  AND column_name IN ('deleted_at', 'deleted_by');

-- Check if new tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('account_history', 'barangay_history');
```

**Expected output:**
```
column_name | data_type
------------|------------------
deleted_at  | timestamp with time zone
deleted_by  | uuid

table_name
------------------
account_history
barangay_history
```

✅ If you see these results, migrations succeeded!

---

### **STEP 4: Update Environment Variables** (if needed)

#### **4.1. Check DOST-api/.env**
```bash
cd DOST-api
code .env
# or
notepad .env
```

**Required variables:**
```env
PORT=5000
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/dostbesmart_db
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
```

#### **4.2. Check DOST-web-app/.env**
```bash
cd DOST-web-app
code .env
# or
notepad .env
```

**Required variables:**
```env
VITE_API_URL=http://localhost:5000/api
```

---

### **STEP 5: Restart Servers**

#### **5.1. Restart Backend (DOST-api)**
```bash
cd DOST-api

# Stop the current server (Ctrl+C in terminal)
# Then restart:
npm run dev
```

**Expected output:**
```
Server running on http://localhost:5000
Connected to PostgreSQL database: dostbesmart_db
```

#### **5.2. Restart Frontend (DOST-web-app)**
```bash
cd DOST-web-app

# Stop the current server (Ctrl+C in terminal)
# Then restart:
npm run dev
```

**Expected output:**
```
VITE ready in XXX ms
➜  Local:   http://localhost:5173/
```

---

### **STEP 6: Verify System Works**

#### **6.1. Test Super Admin Login**
1. Open browser: `http://localhost:5173`
2. Login with Super Admin credentials
3. Navigate to **User Management**
4. Navigate to **Barangay Management**

#### **6.2. Test Create/Delete Flow**
1. **Create a test barangay:**
   - Go to Barangay Management
   - Click "Add Barangay" or "Create First Barangay"
   - Enter: Name = "Test Barangay", Captain = "Test Captain", Email = "test@example.com"
   - Save

2. **Delete the test barangay:**
   - Click "Actions" → "Delete"
   - Confirm deletion

3. **Verify soft delete:**
   - Expand "Deleted Barangays History" section
   - You should see "Test Barangay" with deletion timestamp
   - ✅ Soft delete working!

4. **Test create Punong Barangay:**
   - Go to User Management
   - Click "Add Barangay Admin"
   - Fill in details
   - Save
   - Verify user appears in the table

5. **Test delete Punong Barangay:**
   - Click "Actions" → "Delete Account"
   - Confirm deletion
   - Expand "Deleted History" tab
   - Verify user appears with deletion timestamp
   - ✅ User soft delete working!

---

### **STEP 7: Clean Test Data (Optional)**

If you want a pristine database after testing:

#### **7.1. Run cleanup script in pgAdmin**
1. Open Query Tool
2. Open file: `DOST-api/src/db/migrations/cleanup_for_uat.sql`
3. Execute
4. Hard refresh browser (`Ctrl + Shift + R`)
5. Verify "Deleted History" sections show 0

---

## 🔧 **Troubleshooting**

### **Issue 1: Migration fails with "relation already exists"**
**Solution:** The migration was already run. Skip it and continue to the next one.

### **Issue 2: "column does not exist: deleted_at"**
**Solution:** Run the migrations again. You likely missed one.

### **Issue 3: API won't start - "port already in use"**
**Solution:**
```bash
# Windows
netstat -ano | findstr :5000
taskkill /PID <PID> /F

# Then restart API
npm run dev
```

### **Issue 4: Frontend shows old data after pull**
**Solution:**
```bash
# Clear build cache
npm run build
# Hard refresh browser
Ctrl + Shift + R
```

### **Issue 5: "Cannot read property 'barangay' of undefined"**
**Solution:** 
- Logout and login again
- Clear browser cache
- Verify `.env` files are correct

---

## 📞 **Need Help?**

### **Common Commands Reference**

```bash
# Check current branch
git branch

# Check git status
git status

# Pull latest changes
git pull origin main

# Install dependencies
npm install

# Start backend
cd DOST-api && npm run dev

# Start frontend
cd DOST-web-app && npm run dev

# Check PostgreSQL connection
psql -U postgres -d dostbesmart_db -c "SELECT NOW();"
```

### **Database Quick Check**
```sql
-- Verify migrations ran
SELECT 
  COUNT(*) FILTER (WHERE column_name = 'deleted_at') as users_soft_delete,
  COUNT(*) FILTER (WHERE table_name = 'account_history') as account_history_exists,
  COUNT(*) FILTER (WHERE table_name = 'barangay_history') as barangay_history_exists
FROM information_schema.columns
WHERE table_schema = 'public';
```

Expected: `users_soft_delete: 2`, `account_history_exists: 6+`, `barangay_history_exists: 6+`

---

## ✅ **Deployment Checklist**

Print this and check off as you go:

- [ ] Pulled latest DOST-api code (`git pull origin main`)
- [ ] Pulled latest DOST-web-app code (`git pull origin main`)
- [ ] Installed dependencies (`npm install` in both folders)
- [ ] Ran `add_account_history.sql` migration
- [ ] Ran `add_barangay_soft_delete_and_history.sql` migration
- [ ] Verified migrations with SQL query
- [ ] Checked `.env` files (API and Web)
- [ ] Restarted backend server (`npm run dev`)
- [ ] Restarted frontend server (`npm run dev`)
- [ ] Tested Super Admin login
- [ ] Tested create barangay
- [ ] Tested delete barangay (verified soft delete)
- [ ] Tested create Punong Barangay
- [ ] Tested delete Punong Barangay (verified soft delete)
- [ ] (Optional) Ran cleanup script
- [ ] System ready for UAT! 🎉

---

## 🎯 **What's New for UAT Users**

When handing over to UAT testers, highlight these improvements:

### **For Super Admin:**
1. ✅ **Deleted accounts preserved** - Can view history of deleted users and barangays
2. ✅ **Email reuse** - Can reuse email addresses from deleted accounts
3. ✅ **Barangay name reuse** - Can reuse barangay names after deletion
4. ✅ **Clean cluster management** - Automatic cleanup when barangays deleted
5. ✅ **Audit trail** - Full history of who deleted what and when
6. ✅ **Dynamic date filters** - Year dropdowns start from 2026 (implementation year)
7. ✅ **Better sorting** - Records sorted by date, then alphabetically

### **For Punong Barangay:**
1. ✅ **Dynamic barangay data** - Dashboard shows actual assigned barangay
2. ✅ **Current year focus** - All date filters start from 2026 forward
3. ✅ **Improved performance** - Faster page loads with optimized queries

---

## 🎉 **Done!**

Your teammate should now have a fully updated system matching the UAT-ready production environment.

**Questions?** Contact the development team or refer to the architecture rules in `.kiro/steering/`.
