/**
 * tiersRoutes.js — BE-SMART Dynamic Tiers CRUD
 *
 * GET    /api/tiers          — list all tiers
 * POST   /api/tiers          — create tier
 * PUT    /api/tiers/:id      — update tier
 * DELETE /api/tiers/:id      — delete tier (blocks if bins assigned)
 */

const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const jwt     = require('jsonwebtoken');

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

// GET /api/tiers
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM public.tiers ORDER BY name ASC'
    );
    return res.status(200).json({ tiers: result.rows });
  } catch (err) {
    console.error('Get tiers error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /api/tiers
router.post('/', authenticate, async (req, res) => {
  const { name, capacity_liters } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ error: 'Tier name is required.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO public.tiers (name, capacity_liters)
       VALUES ($1, $2) RETURNING *`,
      [name.trim(), capacity_liters ?? null]
    );
    return res.status(201).json({ tier: result.rows[0] });
  } catch (err) {
    console.error('Create tier error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// PUT /api/tiers/:id
router.put('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { name, capacity_liters } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ error: 'Tier name is required.' });
  }
  try {
    const result = await pool.query(
      `UPDATE public.tiers
          SET name = $1, capacity_liters = $2, updated_at = NOW()
        WHERE id = $3
        RETURNING *`,
      [name.trim(), capacity_liters ?? null, id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Tier not found.' });
    }
    return res.status(200).json({ tier: result.rows[0] });
  } catch (err) {
    console.error('Update tier error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// DELETE /api/tiers/:id
router.delete('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    // Block deletion if bins are assigned to this tier
    const binCheck = await pool.query(
      'SELECT COUNT(*) FROM public.bins WHERE tier_id = $1',
      [id]
    );
    if (parseInt(binCheck.rows[0].count) > 0) {
      return res.status(409).json({
        error: 'Cannot delete tier — bins are currently assigned to it. Reassign or delete those bins first.',
      });
    }
    const result = await pool.query(
      'DELETE FROM public.tiers WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Tier not found.' });
    }
    return res.status(200).json({ message: 'Tier deleted successfully.' });
  } catch (err) {
    console.error('Delete tier error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
