const bcrypt = require('bcrypt');
const pool   = require('../db');

// ─── Normalizer ───────────────────────────────────────────────────────────────
// Converts a raw DB row into the camelCase shape the frontend expects.
// Never includes password_hash.
function normalizeCollector(row) {
  return {
    id:           row.id,
    name:         row.name,
    email:        row.email,
    role:         'collector',
    isActive:     row.is_active,
    assignedUnit: row.unit_name  ?? null,   // unit name, or null if unassigned
    assignedUnitId: row.unit_id ?? null,
    lastLogin:    row.last_login ?? null,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
  };
}

// ─── GET /api/collectors ──────────────────────────────────────────────────────
// Returns all collector accounts with their assigned unit name.
async function listCollectors(req, res) {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.is_active, u.last_login,
              u.created_at, u.updated_at,
              cu.id   AS unit_id,
              cu.name AS unit_name
         FROM users u
         LEFT JOIN collector_unit_members cum ON cum.collector_id = u.id
         LEFT JOIN collector_units cu         ON cu.id = cum.unit_id
         WHERE u.role = 'collector'
         ORDER BY u.name ASC`
    );
    return res.json(result.rows.map(normalizeCollector));
  } catch (err) {
    console.error('listCollectors error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── GET /api/collectors/:id ──────────────────────────────────────────────────
async function getCollector(req, res) {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.is_active, u.last_login,
              u.created_at, u.updated_at,
              cu.id   AS unit_id,
              cu.name AS unit_name
         FROM users u
         LEFT JOIN collector_unit_members cum ON cum.collector_id = u.id
         LEFT JOIN collector_units cu         ON cu.id = cum.unit_id
         WHERE u.id = $1 AND u.role = 'collector'`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Collector not found.' });
    }
    return res.json(normalizeCollector(result.rows[0]));
  } catch (err) {
    console.error('getCollector error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── POST /api/collectors ─────────────────────────────────────────────────────
// Creates a new collector account.
// Body: { name, email, tempPassword }
// Role is always 'collector'; status defaults to active (is_active = true).
async function createCollector(req, res) {
  const { name, email, tempPassword } = req.body;

  // 1. Required fields
  if (!name || !email || !tempPassword) {
    return res.status(400).json({ error: 'name, email, and tempPassword are required.' });
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
      [email.trim().toLowerCase()]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }

    // 5. Hash password
    const password_hash = await bcrypt.hash(tempPassword, 10);

    // 6. Insert — role fixed to 'collector', is_active defaults to true
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
         VALUES ($1, $2, $3, 'collector')
         RETURNING id, name, email, is_active, last_login, created_at, updated_at`,
      [name.trim(), email.trim().toLowerCase(), password_hash]
    );
    const row = result.rows[0];

    return res.status(201).json(normalizeCollector(row));
  } catch (err) {
    console.error('createCollector error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── PATCH /api/collectors/:id ────────────────────────────────────────────────
// Partial update: name, email, isActive, and/or password reset.
async function updateCollector(req, res) {
  const { id } = req.params;
  const { name, email, isActive, newPassword } = req.body;

  if (name === undefined && email === undefined && isActive === undefined && newPassword === undefined) {
    return res.status(400).json({ error: 'Provide at least one field to update: name, email, isActive, or newPassword.' });
  }

  // Validate email format if provided
  if (email !== undefined) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }
  }

  // Validate new password length if provided
  if (newPassword !== undefined && newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    // Confirm target exists and is a collector
    const existing = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND role = 'collector' LIMIT 1`,
      [id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Collector not found.' });
    }

    // Check email uniqueness if changing it
    if (email !== undefined) {
      const clash = await pool.query(
        'SELECT id FROM users WHERE email = $1 AND id <> $2 LIMIT 1',
        [email.trim().toLowerCase(), id]
      );
      if (clash.rows.length > 0) {
        return res.status(400).json({ error: 'An account with this email already exists.' });
      }
    }

    // Build dynamic SET clause
    const fields = [];
    const values = [];
    let idx = 1;

    if (name     !== undefined) { fields.push(`name = $${idx++}`);      values.push(name.trim()); }
    if (email    !== undefined) { fields.push(`email = $${idx++}`);     values.push(email.trim().toLowerCase()); }
    if (isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(isActive); }

    if (newPassword !== undefined) {
      const hash = await bcrypt.hash(newPassword, 10);
      fields.push(`password_hash = $${idx++}`);
      values.push(hash);
    }

    values.push(id);

    const result = await pool.query(
      `UPDATE users SET ${fields.join(', ')}
         WHERE id = $${idx}
         RETURNING id, name, email, is_active, last_login, created_at, updated_at`,
      values
    );
    const row = result.rows[0];

    // Fetch assigned unit for the response
    const unitResult = await pool.query(
      `SELECT cu.id, cu.name
         FROM collector_unit_members cum
         JOIN collector_units cu ON cu.id = cum.unit_id
         WHERE cum.collector_id = $1`,
      [id]
    );
    const unit = unitResult.rows[0] ?? null;

    return res.json(normalizeCollector({ ...row, unit_id: unit?.id ?? null, unit_name: unit?.name ?? null }));
  } catch (err) {
    console.error('updateCollector error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── DELETE /api/collectors/:id ───────────────────────────────────────────────
// Deletes a collector account and unassigns them from their unit.
// The unit itself is NOT deleted.
async function deleteCollector(req, res) {
  const { id } = req.params;
  try {
    // collector_unit_members has ON DELETE CASCADE on collector_id (via users FK),
    // so the membership row is removed automatically when the user is deleted.
    const result = await pool.query(
      `DELETE FROM users WHERE id = $1 AND role = 'collector' RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Collector not found.' });
    }
    return res.json({ message: 'Collector account deleted and unassigned from their unit.' });
  } catch (err) {
    console.error('deleteCollector error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── GET /api/collectors/summary ─────────────────────────────────────────────
// Returns the 3 summary cards: totalCollectors, active, inactive.
async function getSummary(req, res) {
  try {
    const result = await pool.query(
      `SELECT
         COUNT(*)                                      AS total,
         COUNT(*) FILTER (WHERE is_active = true)      AS active,
         COUNT(*) FILTER (WHERE is_active = false)     AS inactive
         FROM users
         WHERE role = 'collector'`
    );
    const row = result.rows[0];
    return res.json({
      totalCollectors: Number(row.total),
      active:          Number(row.active),
      inactive:        Number(row.inactive),
    });
  } catch (err) {
    console.error('getSummary (collectors) error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

module.exports = {
  listCollectors,
  getCollector,
  createCollector,
  updateCollector,
  deleteCollector,
  getSummary,
};
