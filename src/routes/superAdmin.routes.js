/**
 * superAdmin.routes.js — All Super Admin CRUD endpoints
 *
 * Mounted at /api/sa in index.js
 *
 * ── Barangay Admins (punong_barangay users) ───────────────────────────────────
 *   GET    /api/sa/barangay-admins          list PB accounts with stats
 *   POST   /api/sa/barangay-admins          create PB account
 *   DELETE /api/sa/barangay-admins/:id      delete PB account
 *
 * ── Barangays (canonical list) ───────────────────────────────────────────────
 *   GET    /api/sa/barangays                list with bin/resident counts
 *   POST   /api/sa/barangays                create barangay
 *   PUT    /api/sa/barangays/:id            update name/captain/email/status
 *   DELETE /api/sa/barangays/:id            delete barangay
 *
 * ── Dashboard stats ──────────────────────────────────────────────────────────
 *   GET    /api/sa/dashboard/stats          aggregate stat cards
 *   GET    /api/sa/dashboard/activity       recent scan + route events
 *   GET    /api/sa/dashboard/map-data       bins + trucks + MRF locations
 *
 * ── Collection routes ────────────────────────────────────────────────────────
 *   GET    /api/sa/routes                   paginated history
 *   POST   /api/sa/routes                   save a dispatched route
 *   PUT    /api/sa/routes/:id               update status / resend
 *
 * ── Leaderboard ──────────────────────────────────────────────────────────────
 *   GET    /api/sa/leaderboard              ?month=YYYY-MM
 *
 * ── Notifications ────────────────────────────────────────────────────────────
 *   GET    /api/sa/notifications            list
 *   POST   /api/sa/notifications            broadcast announcement
 */

const express    = require('express');
const bcrypt     = require('bcrypt');
const router     = express.Router();
const pool       = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { logAccountAction, getClusterForBarangay } = require('../utils/accountHistory');
const { logBarangayHistory } = require('../utils/barangayHistory');

const isSA = [authenticate, requireRole('super_admin')];

// ── helpers ───────────────────────────────────────────────────────────────────
function pg500(res, err, label) {
  console.error(`[SA:${label}]`, err.message);
  return res.status(500).json({ error: 'Internal server error.' });
}

// =============================================================================
// BARANGAY ADMINS (punong_barangay users)
// =============================================================================

// GET /api/sa/barangay-admins
router.get('/barangay-admins', ...isSA, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        u.id,
        u.name          AS captain,
        u.email,
        u.barangay      AS name,
        b.id            AS barangay_id,
        u.is_active,
        u.last_login,
        u.created_at,
        COALESCE(b_count.total_bins, 0)        AS "totalBins",
        COALESCE(r_count.active_residents, 0)  AS "activeResidents",
        -- Calculate online status based on last_login
        CASE
          WHEN u.last_login IS NULL THEN 'never'
          WHEN u.last_login > NOW() - INTERVAL '5 minutes' THEN 'online'
          WHEN u.last_login > NOW() - INTERVAL '24 hours' THEN 'recently_active'
          ELSE 'offline'
        END AS online_status
      FROM public.users u
      LEFT JOIN public.barangays b ON b.name = u.barangay AND b.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS total_bins
        FROM   public.bins
        WHERE  barangay = u.barangay
      ) b_count ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS active_residents
        FROM   public.users r
        WHERE  r.role = 'resident'
          AND  r.barangay = u.barangay
          AND  r.is_active = true
      ) r_count ON true
      WHERE u.role = 'punong_barangay'
        AND u.deleted_at IS NULL
      ORDER BY u.created_at DESC
    `);

    const admins = rows.map((r) => ({
      id:               r.id,
      name:             r.name         ?? '',
      barangayId:       r.barangay_id  ?? null,
      captain:          r.captain      ?? '',
      email:            r.email,
      totalBins:        Number(r.totalBins),
      activeResidents:  Number(r.activeResidents),
      isActive:         r.is_active,
      lastLogin:        r.last_login ? r.last_login.toISOString() : null,
      onlineStatus:     r.online_status,
      createdAt:        r.created_at ? r.created_at.toISOString() : null,
    }));

    res.json({ barangayAdmins: admins });
  } catch (err) { pg500(res, err, 'GET barangay-admins'); }
});

// POST /api/sa/barangay-admins
router.post('/barangay-admins', ...isSA, async (req, res) => {
  const { name, captain = '', email, tempPassword, useExisting, existingUserId } = req.body;

  // If assigning existing inactive account to a barangay
  if (useExisting && existingUserId) {
    if (!name?.trim()) {
      return res.status(400).json({ error: 'Barangay name is required.' });
    }
    
    try {
      // Check if user exists and is inactive
      const userCheck = await pool.query(
        `SELECT id, email, name, role FROM public.users 
         WHERE id = $1 AND role = 'punong_barangay' AND is_active = false`,
        [existingUserId]
      );
      
      if (userCheck.rowCount === 0) {
        return res.status(404).json({ error: 'Inactive account not found.' });
      }
      
      const existingUser = userCheck.rows[0];
      
      // Activate and assign to barangay
      const { rows } = await pool.query(
        `UPDATE public.users 
         SET barangay = $1, is_active = true, updated_at = NOW()
         WHERE id = $2
         RETURNING id, name, email, barangay, is_active, last_login, updated_at`,
        [name.trim(), existingUserId]
      );
      
      // Also update the barangays table with captain name from existing account
      await pool.query(
        `UPDATE public.barangays 
         SET captain = $1, contact_email = $2, updated_at = NOW()
         WHERE name = $3`,
        [existingUser.name, existingUser.email, name.trim()]
      );
      
      const u = rows[0];
      
      // Log the enable action
      const clusterName = await getClusterForBarangay(u.barangay);
      await logAccountAction(
        u.id,
        'enabled',
        req.user.id,
        {
          barangayName: u.barangay,
          captainName: u.name,
          clusterName: clusterName
        },
        'Account reactivated and assigned to barangay'
      );
      
      // Calculate online status based on last_login
      const onlineStatus = !u.last_login ? 'never' 
        : (new Date() - new Date(u.last_login)) < 300000 ? 'online'  // 5 mins
        : (new Date() - new Date(u.last_login)) < 86400000 ? 'recently_active'  // 24 hours
        : 'offline';
      
      return res.status(200).json({
        barangayAdmin: {
          id:              u.id,
          name:            u.barangay,
          captain:         u.name,
          email:           u.email,
          totalBins:       0,
          activeResidents: 0,
          isActive:        u.is_active,
          lastLogin:       u.last_login ? u.last_login.toISOString() : null,
          onlineStatus:    onlineStatus,
        },
      });
    } catch (err) { 
      return pg500(res, err, 'POST barangay-admins (assign existing)'); 
    }
  }

  // Creating new account
  if (!name?.trim() || !email?.trim() || !tempPassword) {
    return res.status(400).json({ error: 'name (barangay), email, and tempPassword are required.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  try {
    // Check if an ACTIVE (non-deleted) account with this email already exists
    const existing = await pool.query(
      'SELECT id FROM public.users WHERE email = $1 AND deleted_at IS NULL', 
      [email.trim().toLowerCase()]
    );
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    console.log('[POST barangay-admins] Creating account for:', email, 'Barangay:', name);

    const hash = await bcrypt.hash(tempPassword, 10);
    
    console.log('[POST barangay-admins] Inserting user...');
    
    // For emails of deleted users, we need to use UPDATE instead of INSERT
    // First, check if a deleted user with this email exists
    const deletedUser = await pool.query(
      'SELECT id FROM public.users WHERE email = $1 AND deleted_at IS NOT NULL',
      [email.trim().toLowerCase()]
    );
    
    let u;
    if (deletedUser.rowCount > 0) {
      // Reuse the deleted user's record
      console.log('[POST barangay-admins] Reusing deleted user record...');
      const { rows } = await pool.query(
        `UPDATE public.users 
         SET name = $1, password_hash = $2, barangay = $3, is_active = true, 
             deleted_at = NULL, deleted_by = NULL, updated_at = NOW()
         WHERE email = $4 AND deleted_at IS NOT NULL
         RETURNING id, name, email, barangay, is_active, created_at`,
        [captain.trim(), hash, name.trim(), email.trim().toLowerCase()]
      );
      u = rows[0];
    } else {
      // Create new user
      const { rows } = await pool.query(
        `INSERT INTO public.users (name, email, password_hash, role, barangay, is_active)
         VALUES ($1, $2, $3, 'punong_barangay', $4, true)
         RETURNING id, name, email, barangay, is_active, created_at`,
        [captain.trim(), email.trim().toLowerCase(), hash, name.trim()]
      );
      u = rows[0];
    }

    console.log('[POST barangay-admins] User created, updating barangays table...');
    
    // Try to update the barangays table with captain name (if barangay exists)
    try {
      const updateResult = await pool.query(
        `UPDATE public.barangays 
         SET captain = $1, contact_email = $2, updated_at = NOW()
         WHERE name = $3 AND deleted_at IS NULL
         RETURNING id`,
        [captain.trim(), email.trim().toLowerCase(), name.trim()]
      );
      console.log('[POST barangay-admins] Barangays table update result:', updateResult.rowCount, 'rows');
    } catch (updateErr) {
      console.warn('[POST barangay-admins] Failed to update barangays table:', updateErr.message);
      // Continue anyway - the user account was created successfully
    }
    
    console.log('[POST barangay-admins] Getting cluster info...');
    // Log the account creation
    const clusterName = await getClusterForBarangay(u.barangay);
    console.log('[POST barangay-admins] Cluster name:', clusterName);
    
    console.log('[POST barangay-admins] Logging to history...');
    await logAccountAction(
      u.id,
      'created',
      req.user.id,
      {
        barangayName: u.barangay,
        captainName: u.name,
        clusterName: clusterName
      },
      'New Punong Barangay account created'
    );
    
    console.log('[POST barangay-admins] Success! Returning response.');
    
    res.status(201).json({
      barangayAdmin: {
        id:              u.id,
        name:            u.barangay,
        captain:         u.name,
        email:           u.email,
        totalBins:       0,
        activeResidents: 0,
        isActive:        u.is_active,
        lastLogin:       null,  // New account, never logged in
        onlineStatus:    'never',
      },
    });
  } catch (err) { 
    console.error('[SA:POST barangay-admins] FULL ERROR:', err);
    console.error('[SA:POST barangay-admins] Error stack:', err.stack);
    
    // Handle the unique constraint error for emails
    if (err.code === '23505' && err.constraint === 'users_email_key') {
      return res.status(409).json({ error: 'An account with this email already exists. Please use a different email.' });
    }
    
    pg500(res, err, 'POST barangay-admins'); 
  }
});

// DELETE /api/sa/barangay-admins/:id
// Soft delete - marks as deleted but keeps record for history
router.delete('/barangay-admins/:id', ...isSA, async (req, res) => {
  try {
    // Get user data before soft delete for history logging
    const userResult = await pool.query(
      `SELECT id, name, email, barangay FROM public.users 
       WHERE id = $1 AND role = 'punong_barangay' AND deleted_at IS NULL`,
      [req.params.id]
    );
    
    if (userResult.rowCount === 0) {
      return res.status(404).json({ error: 'Barangay admin not found.' });
    }
    
    const user = userResult.rows[0];
    
    // If barangay is NULL (deleted or unassigned), try to get it from the most recent history
    let barangayName = user.barangay;
    let clusterName = null;
    
    if (!barangayName) {
      // Get the most recent barangay assignment from history
      const historyResult = await pool.query(
        `SELECT barangay_name, cluster_name 
         FROM public.account_history 
         WHERE user_id = $1 AND barangay_name IS NOT NULL 
         ORDER BY created_at DESC 
         LIMIT 1`,
        [user.id]
      );
      
      if (historyResult.rowCount > 0) {
        barangayName = historyResult.rows[0].barangay_name;
        clusterName = historyResult.rows[0].cluster_name;
      }
    } else {
      // Get cluster info from current barangay
      clusterName = await getClusterForBarangay(barangayName);
    }
    
    // Soft delete the user
    await pool.query(
      `UPDATE public.users 
       SET deleted_at = NOW(), deleted_by = $1 
       WHERE id = $2`,
      [req.user.id, req.params.id]
    );
    
    // Log the deletion with the barangay name (from current or history)
    await logAccountAction(
      user.id,
      'deleted',
      req.user.id,
      {
        barangayName: barangayName || null,
        captainName: user.name,
        clusterName: clusterName || null
      },
      'Account permanently deleted'
    );
    
    res.json({ message: 'Barangay admin deleted.' });
  } catch (err) { pg500(res, err, 'DELETE barangay-admins'); }
});

// PATCH /api/sa/barangay-admins/:id/status — Enable/Disable account
router.patch('/barangay-admins/:id/status', ...isSA, async (req, res) => {
  const { isActive } = req.body;
  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ error: 'isActive (boolean) is required.' });
  }
  try {
    // Get current user data before update for history logging
    const currentUser = await pool.query(
      `SELECT id, name, barangay, is_active FROM public.users 
       WHERE id = $1 AND role = 'punong_barangay'`,
      [req.params.id]
    );
    
    if (currentUser.rowCount === 0) {
      return res.status(404).json({ error: 'Barangay admin not found.' });
    }
    
    const user = currentUser.rows[0];
    
    // Update the status
    const { rows } = await pool.query(
      `UPDATE public.users 
       SET is_active = $1, updated_at = NOW()
       WHERE id = $2 AND role = 'punong_barangay'
       RETURNING id, is_active, barangay, name`,
      [isActive, req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Barangay admin not found.' });
    }
    
    const updatedUser = rows[0];
    
    // Log the action (only if status actually changed)
    if (user.is_active !== isActive) {
      const clusterName = updatedUser.barangay ? await getClusterForBarangay(updatedUser.barangay) : null;
      await logAccountAction(
        updatedUser.id,
        isActive ? 'enabled' : 'disabled',
        req.user.id,
        {
          barangayName: updatedUser.barangay,
          captainName: updatedUser.name,
          clusterName: clusterName
        },
        isActive ? 'Account enabled by Super Admin' : 'Account disabled by Super Admin'
      );
    }
    
    res.json({ 
      message: isActive ? 'Account enabled.' : 'Account disabled.',
      isActive: updatedUser.is_active
    });
  } catch (err) { pg500(res, err, 'PATCH barangay-admins status'); }
});

// GET /api/sa/barangay-admins/deleted — Fetch deleted accounts with history and optional date filtering
router.get('/barangay-admins/deleted', ...isSA, async (req, res) => {
  const { year, month, day } = req.query;
  
  try {
    let dateFilter = '';
    const params = [];
    
    if (year) {
      dateFilter = 'AND EXTRACT(YEAR FROM u.deleted_at) = $1';
      params.push(parseInt(year));
      
      if (month) {
        dateFilter += ' AND EXTRACT(MONTH FROM u.deleted_at) = $2';
        params.push(parseInt(month));
        
        if (day) {
          dateFilter += ' AND EXTRACT(DAY FROM u.deleted_at) = $3';
          params.push(parseInt(day));
        }
      }
    }
    
    const { rows } = await pool.query(`
      SELECT
        u.id,
        u.name          AS captain,
        u.email,
        u.barangay      AS name,
        u.created_at,
        u.deleted_at,
        u.deleted_by,
        deleter.name    AS deleted_by_name,
        -- Get history snapshots from the deletion record
        h.barangay_name AS barangay_snapshot,
        h.cluster_name  AS cluster_snapshot
      FROM public.users u
      LEFT JOIN public.users deleter ON u.deleted_by = deleter.id
      LEFT JOIN LATERAL (
        SELECT barangay_name, cluster_name
        FROM public.account_history
        WHERE user_id = u.id AND action = 'deleted'
        ORDER BY created_at DESC
        LIMIT 1
      ) h ON true
      WHERE u.role = 'punong_barangay'
        AND u.deleted_at IS NOT NULL ${dateFilter}
      ORDER BY u.deleted_at DESC
    `, params);

    const deletedAccounts = rows.map((r) => ({
      id:                r.id,
      captain:           r.captain      ?? '',
      email:             r.email,
      barangayName:      r.barangay_snapshot ?? r.name ?? 'N/A',
      clusterName:       r.cluster_snapshot ?? 'No Cluster',
      createdAt:         r.created_at ? r.created_at.toISOString() : null,
      deletedAt:         r.deleted_at ? r.deleted_at.toISOString() : null,
      deletedBy:         r.deleted_by_name ?? 'Unknown',
    }));

    res.json({ deletedAccounts });
  } catch (err) { pg500(res, err, 'GET barangay-admins/deleted'); }
});

// =============================================================================
// BARANGAYS
// =============================================================================

// GET /api/sa/barangays
router.get('/barangays', ...isSA, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        bg.id,
        bg.name,
        bg.captain,
        bg.contact_email  AS email,
        bg.status,
        bg.updated_at     AS "lastActivity",
        COALESCE(b_cnt.total, 0)  AS "totalBins",
        COALESCE(r_cnt.total, 0)  AS "activeResidents"
      FROM public.barangays bg
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS total FROM public.bins WHERE barangay = bg.name
      ) b_cnt ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS total FROM public.users
        WHERE role = 'resident' AND barangay = bg.name AND is_active = true
      ) r_cnt ON true
      WHERE bg.deleted_at IS NULL
      ORDER BY bg.name ASC
    `);

    res.json({ barangays: rows.map((r) => ({
      id:              r.id,
      name:            r.name,
      captain:         r.captain ?? '',
      email:           r.email   ?? '',
      status:          r.status,
      totalBins:       Number(r.totalBins),
      activeResidents: Number(r.activeResidents),
      lastActivity:    r.lastActivity?.toISOString().split('T')[0] ?? null,
    })) });
  } catch (err) { pg500(res, err, 'GET barangays'); }
});

// POST /api/sa/barangays
router.post('/barangays', ...isSA, async (req, res) => {
  const { name, captain, email } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Barangay name is required.' });

  try {
    // Check if an ACTIVE (non-deleted) barangay with this name already exists
    const existing = await pool.query(
      'SELECT id FROM public.barangays WHERE name = $1 AND deleted_at IS NULL',
      [name.trim()]
    );
    
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'Barangay already exists.' });
    }
    
    // Check if a DELETED barangay with this name exists
    const deleted = await pool.query(
      'SELECT id FROM public.barangays WHERE name = $1 AND deleted_at IS NOT NULL',
      [name.trim()]
    );
    
    let b;
    if (deleted.rowCount > 0) {
      // Restore the deleted barangay
      const { rows } = await pool.query(
        `UPDATE public.barangays 
         SET captain = $1, contact_email = $2, status = 'active', 
             deleted_at = NULL, deleted_by = NULL, updated_at = NOW()
         WHERE name = $3 AND deleted_at IS NOT NULL
         RETURNING id, name, captain, contact_email AS email, status, created_at`,
        [captain?.trim() ?? null, email?.trim().toLowerCase() ?? null, name.trim()]
      );
      b = rows[0];
      
      // Log restoration to history
      await logBarangayHistory({
        barangayId: b.id,
        action: 'created',
        snapshot: { name: b.name, captain: b.captain, email: b.email, status: b.status },
        performedBy: req.user.id,
      });
    } else {
      // Create new barangay
      const { rows } = await pool.query(
        `INSERT INTO public.barangays (name, captain, contact_email)
         VALUES ($1, $2, $3)
         RETURNING id, name, captain, contact_email AS email, status, created_at`,
        [name.trim(), captain?.trim() ?? null, email?.trim().toLowerCase() ?? null]
      );
      b = rows[0];
      
      // Log creation to history
      await logBarangayHistory({
        barangayId: b.id,
        action: 'created',
        snapshot: { name: b.name, captain: b.captain, email: b.email, status: b.status },
        performedBy: req.user.id,
      });
    }
    
    res.status(201).json({ barangay: {
      id: b.id, name: b.name, captain: b.captain ?? '', email: b.email ?? '',
      status: b.status, totalBins: 0, activeResidents: 0,
      lastActivity: b.created_at.toISOString().split('T')[0],
    }});
  } catch (err) {
    if (err.code === '23505') {
      // This shouldn't happen now, but just in case
      return res.status(409).json({ error: 'A barangay with this name already exists.' });
    }
    pg500(res, err, 'POST barangays');
  }
});

// PUT /api/sa/barangays/:id
router.put('/barangays/:id', ...isSA, async (req, res) => {
  const { name, captain, email, status } = req.body;
  try {
    // First, get the old barangay name so we can update user records
    const oldBarangay = await pool.query(
      'SELECT name FROM public.barangays WHERE id = $1',
      [req.params.id]
    );
    
    if (oldBarangay.rowCount === 0) {
      return res.status(404).json({ error: 'Barangay not found.' });
    }
    
    const oldName = oldBarangay.rows[0].name;
    
    // Update the barangay record
    const { rows } = await pool.query(
      `UPDATE public.barangays
       SET name          = COALESCE($1, name),
           captain       = COALESCE($2, captain),
           contact_email = COALESCE($3, contact_email),
           status        = COALESCE($4, status),
           updated_at    = NOW()
       WHERE id = $5
       RETURNING id, name, captain, contact_email AS email, status, updated_at`,
      [name?.trim() ?? null, captain?.trim() ?? null,
       email?.trim().toLowerCase() ?? null, status ?? null,
       req.params.id]
    );
    
    const updatedBarangay = rows[0];
    
    // If the barangay name changed, update all users (Punong Barangay + residents) with that barangay
    if (name && name.trim() !== oldName) {
      await pool.query(
        'UPDATE public.users SET barangay = $1, updated_at = NOW() WHERE barangay = $2',
        [updatedBarangay.name, oldName]
      );
      
      // Also update bins table
      await pool.query(
        'UPDATE public.bins SET barangay = $1, updated_at = NOW() WHERE barangay = $2',
        [updatedBarangay.name, oldName]
      );
    }
    
    // Log update to history
    await logBarangayHistory({
      barangayId: updatedBarangay.id,
      action: 'updated',
      snapshot: { 
        name: updatedBarangay.name, 
        captain: updatedBarangay.captain, 
        email: updatedBarangay.email, 
        status: updatedBarangay.status,
        oldName: oldName !== updatedBarangay.name ? oldName : undefined
      },
      performedBy: req.user.id,
    });
    
    res.json({ barangay: updatedBarangay });
  } catch (err) { pg500(res, err, 'PUT barangays'); }
});

// DELETE /api/sa/barangays/:id — soft delete
router.delete('/barangays/:id', ...isSA, async (req, res) => {
  try {
    // First, get the barangay data for history snapshot
    const barangayResult = await pool.query(
      'SELECT id, name, captain, contact_email AS email, status FROM public.barangays WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id]
    );
    
    if (barangayResult.rowCount === 0) {
      return res.status(404).json({ error: 'Barangay not found.' });
    }
    
    const barangay = barangayResult.rows[0];
    
    // Remove from cluster membership first
    await pool.query(
      'DELETE FROM public.cluster_barangays WHERE barangay_id = $1',
      [req.params.id]
    );
    
    // Mark all users belonging to this barangay as inactive and unassigned
    // This includes punong_barangay and residents
    await pool.query(
      'UPDATE public.users SET is_active = false, barangay = NULL, updated_at = NOW() WHERE barangay = $1',
      [barangay.name]
    );
    
    // Soft delete the barangay
    await pool.query(
      'UPDATE public.barangays SET deleted_at = NOW(), deleted_by = $1 WHERE id = $2',
      [req.user.id, req.params.id]
    );
    
    // Log deletion to history
    await logBarangayHistory({
      barangayId: barangay.id,
      action: 'deleted',
      snapshot: { 
        name: barangay.name, 
        captain: barangay.captain, 
        email: barangay.email, 
        status: barangay.status 
      },
      performedBy: req.user.id,
    });
    
    res.json({ message: 'Barangay deleted. Associated user accounts marked as inactive and unassigned.' });
  } catch (err) { 
    pg500(res, err, 'DELETE barangays'); 
  }
});

// GET /api/sa/barangays/deleted — Fetch deleted barangays with history and optional date filtering
router.get('/barangays/deleted', ...isSA, async (req, res) => {
  const { year, month, day } = req.query;
  
  try {
    let dateFilter = '';
    const params = [];
    
    if (year) {
      dateFilter = 'AND EXTRACT(YEAR FROM b.deleted_at) = $1';
      params.push(parseInt(year));
      
      if (month) {
        dateFilter += ' AND EXTRACT(MONTH FROM b.deleted_at) = $2';
        params.push(parseInt(month));
        
        if (day) {
          dateFilter += ' AND EXTRACT(DAY FROM b.deleted_at) = $3';
          params.push(parseInt(day));
        }
      }
    }
    
    const { rows } = await pool.query(`
      SELECT
        b.id,
        b.name,
        b.captain,
        b.contact_email AS email,
        b.status,
        b.created_at,
        b.deleted_at,
        b.deleted_by,
        u.name AS deleted_by_name,
        h.snapshot->>'captain' AS captain_at_deletion,
        h.snapshot->>'email' AS email_at_deletion
      FROM public.barangays b
      LEFT JOIN public.users u ON u.id = b.deleted_by
      LEFT JOIN LATERAL (
        SELECT snapshot
        FROM public.barangay_history
        WHERE barangay_id = b.id AND action = 'deleted'
        ORDER BY performed_at DESC
        LIMIT 1
      ) h ON true
      WHERE b.deleted_at IS NOT NULL ${dateFilter}
      ORDER BY b.deleted_at DESC
    `, params);

    const deletedBarangays = rows.map((r) => ({
      id: r.id,
      name: r.name,
      captain: r.captain_at_deletion || r.captain || '',
      email: r.email_at_deletion || r.email || '',
      status: r.status,
      createdAt: r.created_at ? r.created_at.toISOString() : null,
      deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
      deletedBy: r.deleted_by_name || 'Unknown',
    }));

    res.json({ deletedBarangays });
  } catch (err) {
    pg500(res, err, 'GET barangays/deleted');
  }
});

// =============================================================================
// DASHBOARD
// =============================================================================

// GET /api/sa/dashboard/stats
router.get('/dashboard/stats', ...isSA, async (req, res) => {
  try {
    const [bins, scans, units] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)                                          AS "totalBins",
          COUNT(*) FILTER (WHERE status = 'FULL')          AS "fullBins",
          COUNT(*) FILTER (WHERE status = 'COLLECTED'
            AND updated_at::date = CURRENT_DATE)           AS "collectedToday"
        FROM public.bins
      `),
      pool.query(`
        SELECT COUNT(*) AS active_trucks
        FROM public.collector_units
        WHERE status = 'en_route'
      `),
      pool.query(`SELECT 1`),   // placeholder for future metrics
    ]);

    const b = bins.rows[0];
    res.json({
      totalBins:      Number(b.totalBins),
      fullBins:       Number(b.fullBins),
      collectedToday: Number(b.collectedToday),
      activeTrucks:   Number(scans.rows[0].active_trucks),
    });
  } catch (err) { pg500(res, err, 'GET dashboard/stats'); }
});

// GET /api/sa/dashboard/activity  — last 10 events
router.get('/dashboard/activity', ...isSA, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      (
        SELECT
          sl.id,
          'bin_reported'        AS event,
          b.name || ' (' || b.barangay || ') Iniulat na puno ng residente' AS description,
          sl.scanned_at         AS ts
        FROM public.scan_logs sl
        JOIN public.bins b ON b.id = sl.bin_id
        WHERE sl.collected_at IS NULL
        ORDER BY sl.scanned_at DESC
        LIMIT 5
      )
      UNION ALL
      (
        SELECT
          sl2.id,
          'collection_confirmed' AS event,
          b2.name || ' (' || b2.barangay || ') Nakolekta' AS description,
          sl2.collected_at        AS ts
        FROM public.scan_logs sl2
        JOIN public.bins b2 ON b2.id = sl2.bin_id
        WHERE sl2.collected_at IS NOT NULL
        ORDER BY sl2.collected_at DESC
        LIMIT 5
      )
      ORDER BY ts DESC
      LIMIT 10
    `);

    res.json({ activity: rows.map((r) => ({
      id:          r.id,
      event:       r.event,
      description: r.description,
      timestamp:   r.ts,
    })) });
  } catch (err) { pg500(res, err, 'GET dashboard/activity'); }
});

// GET /api/sa/dashboard/map-data  — bins + trucks + MRF stubs
router.get('/dashboard/map-data', ...isSA, async (req, res) => {
  try {
    const [binsRes, trucksRes] = await Promise.all([
      pool.query(`
        SELECT id, name, street, barangay, status, latitude AS "posLat", longitude AS "posLng"
        FROM public.bins
        ORDER BY updated_at DESC
      `),
      pool.query(`
        SELECT cu.id, cu.name AS label, cu.status
        FROM public.collector_units cu
      `),
    ]);

    res.json({
      bins:   binsRes.rows,
      trucks: trucksRes.rows,
      mrfs:   [],   // MRF facilities table pending — return empty for now
    });
  } catch (err) { pg500(res, err, 'GET dashboard/map-data'); }
});

// =============================================================================
// COLLECTION ROUTES
// =============================================================================

// GET /api/sa/routes
router.get('/routes', ...isSA, async (req, res) => {
  const { status, year, month, truck_no, page = 1, limit = 20 } = req.query;
  const conditions = [];
  const values     = [];

  if (status)   { values.push(status);   conditions.push(`r.status   = $${values.length}`); }
  if (truck_no) { values.push(truck_no); conditions.push(`r.truck_no = $${values.length}`); }
  if (year)     { values.push(year);     conditions.push(`EXTRACT(YEAR  FROM r.date) = $${values.length}`); }
  if (month)    { values.push(Number(month)); conditions.push(`EXTRACT(MONTH FROM r.date) = $${values.length}`); }

  const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (Number(page) - 1) * Number(limit);
  values.push(Number(limit), offset);

  try {
    const { rows } = await pool.query(
      `SELECT
         r.id, r.route_id AS "routeId", r.date::text AS date,
         r.bin_ids AS bins, r.distance_km AS "distanceKm",
         r.estimated_minutes AS "estimatedMinutes",
         r.algorithm, r.truck_no AS "truckNo",
         r.sent_to AS "sentTo", r.status,
         r.optimized_at AS "optimizedAt", r.sent_at AS "sentAt",
         r.created_at AS "createdAt"
       FROM public.collection_routes r
       ${where}
       ORDER BY r.date DESC, r.created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM public.collection_routes r ${where}`,
      values.slice(0, -2)
    );

    res.json({
      routes: rows,
      total:  Number(countRes.rows[0].count),
      page:   Number(page),
    });
  } catch (err) { pg500(res, err, 'GET routes'); }
});

// POST /api/sa/routes  — save a dispatched optimized route
router.post('/routes', ...isSA, async (req, res) => {
  const {
    routeId, date, bins = [], distanceKm, estimatedMinutes,
    algorithm, truckNo, sentTo,
  } = req.body;

  if (!routeId || !date) {
    return res.status(400).json({ error: 'routeId and date are required.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO public.collection_routes
         (route_id, date, bin_ids, distance_km, estimated_minutes,
          algorithm, truck_no, sent_to, status, optimized_at, sent_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'delivered',NOW(),NOW(),$9)
       RETURNING id, route_id AS "routeId", date::text, status, created_at`,
      [routeId, date, bins, distanceKm ?? null, estimatedMinutes ?? null,
       algorithm ?? 'Nearest Neighbor', truckNo ?? null,
       sentTo ?? 'Collector Admin', req.user.id]
    );
    res.status(201).json({ route: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: `Route ID "${routeId}" already exists.` });
    }
    pg500(res, err, 'POST routes');
  }
});

// PUT /api/sa/routes/:id  — update status / resend
router.put('/routes/:id', ...isSA, async (req, res) => {
  const { status, truckNo, sentTo } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE public.collection_routes
       SET status   = COALESCE($1, status),
           truck_no = COALESCE($2, truck_no),
           sent_to  = COALESCE($3, sent_to),
           sent_at  = CASE WHEN $1 = 'delivered' THEN NOW() ELSE sent_at END
       WHERE id = $4
       RETURNING id, route_id AS "routeId", date::text, status, sent_at AS "sentAt"`,
      [status ?? null, truckNo ?? null, sentTo ?? null, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Route not found.' });
    res.json({ route: rows[0] });
  } catch (err) { pg500(res, err, 'PUT routes'); }
});

// =============================================================================
// LEADERBOARD
// =============================================================================

// GET /api/sa/leaderboard?month=YYYY-MM
router.get('/leaderboard', ...isSA, async (req, res) => {
  const month = req.query.month ?? new Date().toISOString().slice(0, 7);
  const [year, mon] = month.split('-').map(Number);
  if (!year || !mon) return res.status(400).json({ error: 'month must be YYYY-MM format.' });

  try {
    const { rows } = await pool.query(`
      SELECT
        bg.id            AS "barangayId",
        bg.name,
        COALESCE(r_stats.reports, 0)   AS "reportsSubmitted",
        COALESCE(r_stats.eco_pts, 0)   AS "pointsEarned",
        COALESCE(c_stats.rate, 0)      AS "collectionRate"
      FROM public.barangays bg
      LEFT JOIN LATERAL (
        SELECT
          COUNT(sl.id)             AS reports,
          COALESCE(SUM(sl.eco_awarded), 0) AS eco_pts
        FROM public.scan_logs sl
        JOIN public.bins b ON b.id = sl.bin_id
        WHERE b.barangay = bg.name
          AND EXTRACT(YEAR  FROM sl.scanned_at) = $1
          AND EXTRACT(MONTH FROM sl.scanned_at) = $2
      ) r_stats ON true
      LEFT JOIN LATERAL (
        SELECT
          CASE
            WHEN COUNT(*) = 0 THEN 0
            ELSE ROUND(
              COUNT(*) FILTER (WHERE sl2.collected_at IS NOT NULL) * 100.0 / COUNT(*)
            )
          END AS rate
        FROM public.scan_logs sl2
        JOIN public.bins b2 ON b2.id = sl2.bin_id
        WHERE b2.barangay = bg.name
          AND EXTRACT(YEAR  FROM sl2.scanned_at) = $1
          AND EXTRACT(MONTH FROM sl2.scanned_at) = $2
      ) c_stats ON true
      ORDER BY "pointsEarned" DESC, "reportsSubmitted" DESC
    `, [year, mon]);

    const ranked = rows.map((r, i) => {
      const rank = i + 1;
      return {
        rank,
        barangayId:       r.barangayId,
        name:             r.name,
        reportsSubmitted: Number(r.reportsSubmitted),
        pointsEarned:     Number(r.pointsEarned),
        collectionRate:   Number(r.collectionRate),
        badge: rank === 1 ? 'gold' : rank === 2 ? 'gold' : rank === 3 ? 'gold'
             : rank <= 6  ? 'silver' : rank <= 9 ? 'bronze' : null,
      };
    });

    res.json({ leaderboard: ranked, month });
  } catch (err) { pg500(res, err, 'GET leaderboard'); }
});

// =============================================================================
// NOTIFICATIONS
// =============================================================================

// GET /api/sa/notifications
router.get('/notifications', ...isSA, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, type, title, body, target, priority, sent_at AS "sentAt", read
       FROM public.announcements
       ORDER BY sent_at DESC
       LIMIT 100`
    );
    res.json({ notifications: rows });
  } catch (err) { pg500(res, err, 'GET notifications'); }
});

// POST /api/sa/notifications
router.post('/notifications', ...isSA, async (req, res) => {
  const { title, body, priority = 'normal', type = 'announcement', target = 'all' } = req.body;
  if (!title?.trim() || !body?.trim()) {
    return res.status(400).json({ error: 'title and body are required.' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.announcements (type, title, body, target, priority, sent_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, type, title, body, target, priority, sent_at AS "sentAt", read`,
      [type, title.trim(), body.trim(), target, priority, req.user.id]
    );
    const notif = rows[0];

    // Push via Socket.IO if available
    const io = req.app.get('io');
    if (io) io.emit('notification:new', notif);

    res.status(201).json({ notification: notif });
  } catch (err) { pg500(res, err, 'POST notifications'); }
});

// =============================================================================
// CLUSTERS
// =============================================================================

// GET /api/sa/clusters — list all clusters with barangay count + barangay list
router.get('/clusters', ...isSA, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        c.id, c.name, c.label, c.created_at,
        COALESCE(
          json_agg(
            json_build_object('id', b.id, 'name', b.name)
            ORDER BY b.name
          ) FILTER (WHERE b.id IS NOT NULL AND b.deleted_at IS NULL),
          '[]'
        ) AS barangays
      FROM public.clusters c
      LEFT JOIN public.cluster_barangays cb ON cb.cluster_id = c.id
      LEFT JOIN public.barangays b          ON b.id = cb.barangay_id
      GROUP BY c.id, c.name, c.label, c.created_at
      ORDER BY c.label ASC
    `);
    res.json({ clusters: rows });
  } catch (err) { pg500(res, err, 'GET clusters'); }
});

// POST /api/sa/clusters — create a new cluster
router.post('/clusters', ...isSA, async (req, res) => {
  const { name, label } = req.body;
  if (!name?.trim() || !label?.trim()) {
    return res.status(400).json({ error: 'name and label are required.' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.clusters (name, label) VALUES ($1, $2)
       RETURNING id, name, label, created_at`,
      [name.trim().toUpperCase().replace(/\s+/g, '-'), label.trim()]
    );
    res.status(201).json({ cluster: { ...rows[0], barangays: [] } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Cluster name already exists.' });
    pg500(res, err, 'POST clusters');
  }
});

// PUT /api/sa/clusters/:id — rename a cluster
// Note: cluster name changes propagate automatically via JOIN queries in GET endpoints
// since barangays don't store cluster_label directly — they join with clusters table
router.put('/clusters/:id', ...isSA, async (req, res) => {
  const { label } = req.body;
  if (!label?.trim()) return res.status(400).json({ error: 'label is required.' });
  try {
    const { rows } = await pool.query(
      `UPDATE public.clusters SET label = $1 WHERE id = $2
       RETURNING id, name, label`,
      [label.trim(), req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Cluster not found.' });
    res.json({ cluster: rows[0] });
  } catch (err) { pg500(res, err, 'PUT clusters'); }
});

// DELETE /api/sa/clusters/:id — delete a cluster (unassigns its barangays via CASCADE)
router.delete('/clusters/:id', ...isSA, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM public.clusters WHERE id = $1 RETURNING id', [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Cluster not found.' });
    res.json({ message: 'Cluster deleted.' });
  } catch (err) { pg500(res, err, 'DELETE clusters'); }
});

// =============================================================================
// CLUSTER BARANGAY ASSIGNMENT
// =============================================================================

// GET /api/sa/barangays/unassigned — barangays not yet in any cluster
router.get('/barangays/unassigned', ...isSA, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT b.id, b.name
      FROM public.barangays b
      WHERE NOT EXISTS (
        SELECT 1 FROM public.cluster_barangays cb WHERE cb.barangay_id = b.id
      )
      ORDER BY b.name ASC
    `);
    res.json({ barangays: rows });
  } catch (err) { pg500(res, err, 'GET barangays/unassigned'); }
});

// GET /api/sa/barangays/all — full list of all barangays (for dropdown)
// Excludes soft-deleted barangays
router.get('/barangays/all', ...isSA, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT b.id, b.name, b.created_at, cb.cluster_id,
             c.label AS cluster_label
      FROM public.barangays b
      LEFT JOIN public.cluster_barangays cb ON cb.barangay_id = b.id
      LEFT JOIN public.clusters c           ON c.id = cb.cluster_id
      WHERE b.deleted_at IS NULL
      ORDER BY b.name ASC
    `);
    res.json({ barangays: rows });
  } catch (err) { pg500(res, err, 'GET barangays/all'); }
});

// GET /api/sa/barangays/my-cluster — Get cluster info for logged-in user's barangay (accessible by PB)
router.get('/barangays/my-cluster', authenticate, async (req, res) => {
  try {
    // First, fetch the user's barangay from the database
    // JWT only has { id, role }, not barangay
    const userResult = await pool.query(
      'SELECT barangay FROM public.users WHERE id = $1 AND deleted_at IS NULL',
      [req.user.id]
    );
    
    if (!userResult.rows[0] || !userResult.rows[0].barangay) {
      console.log('[GET my-cluster] User has no barangay assigned');
      return res.json({ clusterLabel: null });
    }
    
    const barangayName = userResult.rows[0].barangay;
    console.log('[GET my-cluster] User ID:', req.user.id, 'Barangay:', barangayName);
    
    // Now query the cluster for this barangay
    const { rows } = await pool.query(`
      SELECT c.label AS cluster_label
      FROM public.barangays b
      LEFT JOIN public.cluster_barangays cb ON cb.barangay_id = b.id
      LEFT JOIN public.clusters c           ON c.id = cb.cluster_id
      WHERE b.name = $1 AND b.deleted_at IS NULL
      LIMIT 1
    `, [barangayName]);
    
    console.log('[GET my-cluster] Cluster result:', rows[0]);
    
    res.json({ clusterLabel: rows[0]?.cluster_label || null });
  } catch (err) { 
    console.error('[GET my-cluster] Error:', err);
    pg500(res, err, 'GET barangays/my-cluster'); 
  }
});

// GET /api/sa/barangays/available — barangays without an active admin account
// Used in User Management modal to show only unassigned barangays
router.get('/barangays/available', ...isSA, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT b.id, b.name, b.created_at, cb.cluster_id,
             c.label AS cluster_label
      FROM public.barangays b
      LEFT JOIN public.cluster_barangays cb ON cb.barangay_id = b.id
      LEFT JOIN public.clusters c           ON c.id = cb.cluster_id
      WHERE b.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.users u
          WHERE u.role = 'punong_barangay'
            AND u.barangay = b.name
            AND u.is_active = true
            AND u.deleted_at IS NULL
        )
      ORDER BY b.name ASC
    `);
    res.json({ barangays: rows });
  } catch (err) { pg500(res, err, 'GET barangays/available'); }
});

// POST /api/sa/clusters/:id/barangays — assign a barangay to a cluster
router.post('/clusters/:id/barangays', ...isSA, async (req, res) => {
  const { barangay_id } = req.body;
  if (!barangay_id) return res.status(400).json({ error: 'barangay_id is required.' });

  try {
    // Remove from any previous cluster first (one cluster per barangay)
    await pool.query(
      'DELETE FROM public.cluster_barangays WHERE barangay_id = $1', [barangay_id]
    );
    await pool.query(
      `INSERT INTO public.cluster_barangays (cluster_id, barangay_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.params.id, barangay_id]
    );

    // Return updated cluster (exclude deleted barangays)
    const { rows } = await pool.query(`
      SELECT b.id, b.name
      FROM public.cluster_barangays cb
      JOIN public.barangays b ON b.id = cb.barangay_id
      WHERE cb.cluster_id = $1 AND b.deleted_at IS NULL
      ORDER BY b.name ASC
    `, [req.params.id]);

    res.status(201).json({ barangays: rows });
  } catch (err) { pg500(res, err, 'POST clusters/:id/barangays'); }
});

// DELETE /api/sa/clusters/:id/barangays/:barangayId — unassign a barangay
router.delete('/clusters/:id/barangays/:barangayId', ...isSA, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM public.cluster_barangays WHERE cluster_id=$1 AND barangay_id=$2',
      [req.params.id, req.params.barangayId]
    );
    res.json({ message: 'Barangay unassigned from cluster.' });
  } catch (err) { pg500(res, err, 'DELETE clusters/:id/barangays/:barangayId'); }
});

module.exports = router;
