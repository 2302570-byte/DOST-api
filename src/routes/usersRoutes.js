/**
 * usersRoutes.js — BE-SMART User Management
 *
 * GET    /api/users          — list all users (admin only)
 * POST   /api/users          — create user account
 * PUT    /api/users/:id      — update user
 * DELETE /api/users/:id      — deactivate user
 */

const express  = require('express');
const router   = express.Router();
const pool     = require('../db');
const bcrypt   = require('bcrypt');
const { authenticate } = require('../middleware/auth');

// GET /api/users
router.get('/', authenticate, async (req, res) => {
  const { role, search } = req.query;
  try {
    let conditions = [];
    let values     = [];

    if (role) {
      values.push(role);
      conditions.push(`role = $${values.length}`);
    }
    if (search) {
      values.push(`%${search.toLowerCase()}%`);
      conditions.push(`(LOWER(name) LIKE $${values.length} OR LOWER(email) LIKE $${values.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT
         id, name, email, phone, role, barangay, is_active,
         created_at, updated_at
       FROM public.users
       ${where}
       ORDER BY role ASC, name ASC`,
      values
    );
    return res.json({ users: rows });
  } catch (err) {
    console.error('Get users error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /api/users — create any role (admin use)
router.post('/', authenticate, async (req, res) => {
  const { name, email, phone, barangay, password, role } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'name, email, password and role are required.' });
  }
  try {
    const existing = await pool.query('SELECT id FROM public.users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rowCount > 0) return res.status(409).json({ error: 'Email already exists.' });

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO public.users (name, email, phone, barangay, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING id, name, email, role, barangay, phone, is_active, created_at`,
      [name.trim(), email.trim().toLowerCase(), phone ?? null, barangay ?? null, hash, role]
    );
    return res.status(201).json({ user: rows[0] });
  } catch (err) {
    console.error('Create user error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// PUT /api/users/:id
router.put('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { name, phone, barangay, is_active, role } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE public.users SET
         name      = COALESCE($1, name),
         phone     = COALESCE($2, phone),
         barangay  = COALESCE($3, barangay),
         is_active = COALESCE($4, is_active),
         role      = COALESCE($5, role)
       WHERE id = $6
       RETURNING id, name, email, role, barangay, phone, is_active`,
      [name, phone, barangay, is_active, role, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    return res.json({ user: rows[0] });
  } catch (err) {
    console.error('Update user error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// DELETE /api/users/:id — soft delete (deactivate)
router.delete('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `UPDATE public.users SET is_active = false WHERE id = $1 RETURNING id`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    return res.json({ message: 'User deactivated.' });
  } catch (err) {
    console.error('Delete user error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
