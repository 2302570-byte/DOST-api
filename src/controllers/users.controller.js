const bcrypt = require('bcrypt');
const pool   = require('../db');

// ─── GET /api/users/mrf-workers ───────────────────────────────────────────────
// Returns all users with role = 'mrf_worker'.
// punong_barangay and super_admin roles are allowed.
async function listMrfWorkers(req, res) {
  try {
    const result = await pool.query(
      `SELECT id, name, email, phone, barangay, is_active, last_login, created_at, updated_at
       FROM users
       WHERE role = 'mrf_worker'
       ORDER BY name ASC`,
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('listMrfWorkers error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── POST /api/users/mrf-workers ──────────────────────────────────────────────
// Creates a new mrf_worker account with a temporary password.
async function createMrfWorker(req, res) {
  const { name, email, barangay, tempPassword } = req.body;

  // 1. Validate required fields
  if (!name || !email || !barangay || !tempPassword) {
    return res.status(400).json({ error: 'Name, email, barangay, and tempPassword are required.' });
  }

  // 2. Email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  // 3. Password length
  if (tempPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    // 4. Duplicate email check
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1 LIMIT 1',
      [email.trim().toLowerCase()],
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // 5. Hash password
    const password_hash = await bcrypt.hash(tempPassword, 10);

    // 6. Insert
    const result = await pool.query(
      `INSERT INTO users (name, email, barangay, password_hash, role)
       VALUES ($1, $2, $3, $4, 'mrf_worker')
       RETURNING id, name, email, barangay, is_active, last_login, created_at, updated_at`,
      [
        name.trim(),
        email.trim().toLowerCase(),
        barangay.trim(),
        password_hash,
      ],
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('createMrfWorker error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── PUT /api/users/mrf-workers/:id ──────────────────────────────────────────
// Updates name, email, and/or barangay of an mrf_worker.
// Optionally toggles is_active.
async function updateMrfWorker(req, res) {
  const { id } = req.params;
  const { name, email, barangay, isActive } = req.body;

  // At least one field required
  if (name === undefined && email === undefined && barangay === undefined && isActive === undefined) {
    return res.status(400).json({ error: 'Provide at least one field to update.' });
  }

  // Validate email format if provided
  if (email !== undefined) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }
  }

  try {
    // Confirm target exists and is an mrf_worker
    const existing = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND role = 'mrf_worker' LIMIT 1`,
      [id],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'MRF worker not found.' });
    }

    // Check email uniqueness if changing it
    if (email !== undefined) {
      const clash = await pool.query(
        'SELECT id FROM users WHERE email = $1 AND id <> $2 LIMIT 1',
        [email.trim().toLowerCase(), id],
      );
      if (clash.rows.length > 0) {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }
    }

    // Build dynamic SET clause
    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined)     { fields.push(`name = $${idx++}`);      values.push(name.trim()); }
    if (email !== undefined)    { fields.push(`email = $${idx++}`);     values.push(email.trim().toLowerCase()); }
    if (barangay !== undefined) { fields.push(`barangay = $${idx++}`);  values.push(barangay.trim()); }
    if (isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(isActive); }

    values.push(id);

    const result = await pool.query(
      `UPDATE users SET ${fields.join(', ')}
       WHERE id = $${idx}
       RETURNING id, name, email, barangay, is_active, last_login, created_at, updated_at`,
      values,
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error('updateMrfWorker error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── DELETE /api/users/mrf-workers/:id ───────────────────────────────────────
// Hard-deletes an mrf_worker account.
async function deleteMrfWorker(req, res) {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM users WHERE id = $1 AND role = 'mrf_worker' RETURNING id`,
      [id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'MRF worker not found.' });
    }
    return res.json({ message: 'Account deleted.' });
  } catch (err) {
    console.error('deleteMrfWorker error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

module.exports = { listMrfWorkers, createMrfWorker, updateMrfWorker, deleteMrfWorker };
