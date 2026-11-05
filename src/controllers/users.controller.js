/**
 * users.controller.js — User profile endpoints.
 *
 * GET /api/users/me — returns the authenticated user's profile with
 * role-specific computed stats. Replaces all mock user data in the mobile app.
 *
 * Response shape varies by role:
 *
 *   resident       → { ...base, ecoTokenBalance, totalEarned, totalRedeemed,
 *                       binsReported, itemsRedeemed }
 *
 *   mrf_worker     → { ...base, tokensIssued, scansToday, residentsServed }
 *
 *   collector      → { ...base, assignedUnit, assignedUnitId,
 *                       binsCollectedToday, totalCollectedL }
 *
 *   mrf_buyer      → { ...base, totalPurchases, completedReservations }
 *                     (buyer stats are stubs until MRF reservations domain is built)
 *
 *   all others     → { ...base } (admins use the web app; no extra stats needed)
 *
 * Base fields (all roles):
 *   id, name, email, phone, address, barangay, role, memberSince, initials
 */

const pool = require('../db');

// ── Helper: derive initials from a display name ───────────────────────────────
function getInitials(name = '') {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

// ── Helper: format a date to "MMM YYYY" (e.g. "Jan 2024") ────────────────────
function formatMemberSince(date) {
  return new Date(date).toLocaleString('en-PH', {
    month: 'short',
    year:  'numeric',
  });
}

// ── GET /api/users/me ─────────────────────────────────────────────────────────
async function getMe(req, res) {
  const { id, role } = req.user;

  try {
    // 1. Fetch base user row
    const userResult = await pool.query(
      `SELECT id, name, email, phone, address, barangay, role, created_at
         FROM public.users
         WHERE id = $1 AND is_active = true
         LIMIT 1`,
      [id]
    );

    if (userResult.rowCount === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const u = userResult.rows[0];

    const base = {
      id:          u.id,
      name:        u.name,
      initials:    getInitials(u.name),
      email:       u.email,
      phone:       u.phone        ?? null,
      address:     u.address      ?? null,
      barangay:    u.barangay     ?? null,
      role:        u.role,
      memberSince: formatMemberSince(u.created_at),
    };

    // 2. Role-specific stats ───────────────────────────────────────────────────

    // ── resident ──────────────────────────────────────────────────────────────
    if (role === 'resident') {
      const [balanceRes, earnedRes, redeemedRes, binsRes, itemsRes] =
        await Promise.all([
          // Cached ECO balance
          pool.query(
            `SELECT balance FROM public.user_eco_balances WHERE user_id = $1`,
            [id]
          ),
          // Total ECO ever earned (confirmed bin collections + MRF submissions)
          pool.query(
            `SELECT
               COALESCE(
                 (SELECT SUM(eco_awarded) FROM public.scan_logs
                    WHERE reporter_id = $1 AND eco_tx_status = 'confirmed'),
                 0
               ) +
               COALESCE(
                 (SELECT SUM(eco_awarded) FROM public.waste_submissions
                    WHERE resident_id = $1 AND tx_status = 'confirmed'),
                 0
               ) AS total_earned`,
            [id]
          ),
          // Total ECO ever redeemed (confirmed redemptions)
          pool.query(
            `SELECT COALESCE(SUM(eco_cost), 0) AS total_redeemed
               FROM public.eco_redemptions
               WHERE resident_id = $1 AND tx_status = 'confirmed'`,
            [id]
          ),
          // Total bins reported
          pool.query(
            `SELECT COUNT(*) AS bins_reported
               FROM public.scan_logs
               WHERE reporter_id = $1`,
            [id]
          ),
          // Total rewards redeemed
          pool.query(
            `SELECT COUNT(*) AS items_redeemed
               FROM public.eco_redemptions
               WHERE resident_id = $1`,
            [id]
          ),
        ]);

      return res.json({
        ...base,
        ecoTokenBalance: Number(balanceRes.rows[0]?.balance ?? 0),
        totalEarned:     Number(earnedRes.rows[0]?.total_earned ?? 0),
        totalRedeemed:   Number(redeemedRes.rows[0]?.total_redeemed ?? 0),
        binsReported:    Number(binsRes.rows[0]?.bins_reported ?? 0),
        itemsRedeemed:   Number(itemsRes.rows[0]?.items_redeemed ?? 0),
      });
    }

    // ── mrf_worker ────────────────────────────────────────────────────────────
    if (role === 'mrf_worker') {
      const [tokensRes, todayRes, residentsRes] = await Promise.all([
        // Total ECO ever issued by this worker
        pool.query(
          `SELECT COALESCE(SUM(eco_awarded), 0) AS tokens_issued
             FROM public.waste_submissions
             WHERE mrf_worker_id = $1 AND tx_status = 'confirmed'`,
          [id]
        ),
        // Scans performed today
        pool.query(
          `SELECT COUNT(*) AS scans_today
             FROM public.waste_submissions
             WHERE mrf_worker_id = $1
               AND created_at::date = CURRENT_DATE`,
          [id]
        ),
        // Distinct residents ever served
        pool.query(
          `SELECT COUNT(DISTINCT resident_id) AS residents_served
             FROM public.waste_submissions
             WHERE mrf_worker_id = $1`,
          [id]
        ),
      ]);

      return res.json({
        ...base,
        tokensIssued:    Number(tokensRes.rows[0]?.tokens_issued   ?? 0),
        scansToday:      Number(todayRes.rows[0]?.scans_today       ?? 0),
        residentsServed: Number(residentsRes.rows[0]?.residents_served ?? 0),
      });
    }

    // ── collector ─────────────────────────────────────────────────────────────
    if (role === 'collector') {
      const [unitRes, todayRes, volumeRes] = await Promise.all([
        // Assigned collector unit
        pool.query(
          `SELECT cu.id, cu.name
             FROM public.collector_unit_members cum
             JOIN public.collector_units cu ON cu.id = cum.unit_id
             WHERE cum.collector_id = $1
             LIMIT 1`,
          [id]
        ),
        // Bins collected today
        pool.query(
          `SELECT COUNT(*) AS bins_collected_today
             FROM public.scan_logs
             WHERE collected_by = $1
               AND collected_at::date = CURRENT_DATE`,
          [id]
        ),
        // Total volume collected across all time (litres)
        pool.query(
          `SELECT COALESCE(SUM(volume_liters), 0) AS total_collected_l
             FROM public.scan_logs
             WHERE collected_by = $1
               AND volume_liters IS NOT NULL`,
          [id]
        ),
      ]);

      const unit = unitRes.rows[0] ?? null;

      return res.json({
        ...base,
        assignedUnit:       unit?.name   ?? null,
        assignedUnitId:     unit?.id     ?? null,
        binsCollectedToday: Number(todayRes.rows[0]?.bins_collected_today ?? 0),
        totalCollectedL:    Number(volumeRes.rows[0]?.total_collected_l   ?? 0),
      });
    }

    // ── mrf_buyer ─────────────────────────────────────────────────────────────
    // Reservations/bidding domain not yet built — return zero stubs.
    // These will be wired to real queries when the MRF facilities domain is implemented.
    if (role === 'mrf_buyer') {
      return res.json({
        ...base,
        totalPurchases:        0,
        completedReservations: 0,
      });
    }

    // ── admin roles — base fields only ────────────────────────────────────────
    return res.json(base);

  } catch (err) {
    console.error('getMe error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ── GET /api/users/mrf-workers ────────────────────────────────────────────────
async function listMrfWorkers(req, res) {
  try {
    const result = await pool.query(
      `SELECT id, name, email, phone, barangay, is_active, created_at
         FROM public.users
         WHERE role = 'mrf_worker'
         ORDER BY created_at DESC`
    );
    return res.json(
      result.rows.map((u) => ({
        id:        u.id,
        name:      u.name,
        email:     u.email,
        phone:     u.phone     ?? null,
        barangay:  u.barangay  ?? null,
        isActive:  u.is_active,
        createdAt: u.created_at,
      }))
    );
  } catch (err) {
    console.error('listMrfWorkers error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ── POST /api/users/mrf-workers ───────────────────────────────────────────────
async function createMrfWorker(req, res) {
  const { name, email, password, phone, barangay, address } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, and password are required.' });
  }

  try {
    const bcrypt = require('bcrypt');
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO public.users (name, email, password_hash, phone, barangay, address, role)
         VALUES ($1, $2, $3, $4, $5, $6, 'mrf_worker')
         RETURNING id, name, email, phone, barangay, is_active, created_at`,
      [name, email, passwordHash, phone ?? null, barangay ?? null, address ?? null]
    );

    const u = result.rows[0];
    return res.status(201).json({
      id:        u.id,
      name:      u.name,
      email:     u.email,
      phone:     u.phone    ?? null,
      barangay:  u.barangay ?? null,
      isActive:  u.is_active,
      createdAt: u.created_at,
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A user with that email already exists.' });
    }
    console.error('createMrfWorker error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ── PUT /api/users/mrf-workers/:id ───────────────────────────────────────────
async function updateMrfWorker(req, res) {
  const { id } = req.params;
  const { name, email, phone, barangay, address, isActive } = req.body;

  // Build a dynamic SET clause from provided fields only
  const fields = [];
  const values = [];
  let idx = 1;

  if (name      !== undefined) { fields.push(`name = $${idx++}`);      values.push(name); }
  if (email     !== undefined) { fields.push(`email = $${idx++}`);     values.push(email); }
  if (phone     !== undefined) { fields.push(`phone = $${idx++}`);     values.push(phone); }
  if (barangay  !== undefined) { fields.push(`barangay = $${idx++}`);  values.push(barangay); }
  if (address   !== undefined) { fields.push(`address = $${idx++}`);   values.push(address); }
  if (isActive  !== undefined) { fields.push(`is_active = $${idx++}`); values.push(isActive); }

  if (fields.length === 0) {
    return res.status(400).json({ error: 'No updatable fields provided.' });
  }

  values.push(id);

  try {
    const result = await pool.query(
      `UPDATE public.users
          SET ${fields.join(', ')}
        WHERE id = $${idx} AND role = 'mrf_worker'
        RETURNING id, name, email, phone, barangay, is_active, created_at`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'MRF worker not found.' });
    }

    const u = result.rows[0];
    return res.json({
      id:        u.id,
      name:      u.name,
      email:     u.email,
      phone:     u.phone    ?? null,
      barangay:  u.barangay ?? null,
      isActive:  u.is_active,
      createdAt: u.created_at,
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A user with that email already exists.' });
    }
    console.error('updateMrfWorker error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ── DELETE /api/users/mrf-workers/:id ────────────────────────────────────────
// Soft-delete: sets is_active = false rather than removing the row.
async function deleteMrfWorker(req, res) {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `UPDATE public.users
          SET is_active = false
        WHERE id = $1 AND role = 'mrf_worker'
        RETURNING id`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'MRF worker not found.' });
    }

    return res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('deleteMrfWorker error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

module.exports = { getMe, listMrfWorkers, createMrfWorker, updateMrfWorker, deleteMrfWorker };
