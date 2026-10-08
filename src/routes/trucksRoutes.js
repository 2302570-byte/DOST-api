/**
 * trucksRoutes.js — BE-SMART Truck Fleet Management
 *
 * GET  /api/trucks          — list all trucks
 * POST /api/trucks          — create truck
 * PUT  /api/trucks/:id      — update truck (status, GPS, assignment)
 * DELETE /api/trucks/:id    — delete truck
 */

const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { authenticate } = require('../middleware/auth');

// GET /api/trucks/mine — returns the truck assigned to the authenticated collector
router.get('/mine', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         t.id, t.plate_number, t.name, t.truck_type, t.max_capacity,
         t.status, t.assigned_collector_id, t.cluster_id
       FROM public.trucks t
       WHERE t.assigned_collector_id = $1
       LIMIT 1`,
      [req.user.id]
    );
    if (rows.length === 0) {
      return res.json({ truck: null });
    }
    return res.json({ truck: rows[0] });
  } catch (err) {
    console.error('Get my truck error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// GET /api/trucks
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        t.id, t.plate_number, t.name, t.truck_type, t.max_capacity,
        t.status, t.latitude, t.longitude, t.last_seen_at,
        t.cluster_id,
        t.assigned_collector_id,
        u.name AS assigned_collector_name
      FROM public.trucks t
      LEFT JOIN public.users u ON u.id = t.assigned_collector_id
      ORDER BY t.truck_type ASC, t.name ASC
    `);
    return res.json({ trucks: rows });
  } catch (err) {
    console.error('Get trucks error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /api/trucks
router.post('/', authenticate, async (req, res) => {
  const { plate_number, name, truck_type, max_capacity, cluster_id } = req.body;
  if (!plate_number || !name || !truck_type) {
    return res.status(400).json({ error: 'plate_number, name, and truck_type are required.' });
  }
  const VALID_TYPES = ['10_wheeler', 'forward_truck', 'mini_dump_truck'];
  if (!VALID_TYPES.includes(truck_type)) {
    return res.status(400).json({ error: `truck_type must be one of: ${VALID_TYPES.join(', ')}` });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.trucks (plate_number, name, truck_type, max_capacity, cluster_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [plate_number, name, truck_type, max_capacity ?? defaultCapacity(truck_type), cluster_id ?? null]
    );
    return res.status(201).json({ truck: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Plate number already exists.' });
    console.error('Create truck error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// PUT /api/trucks/:id
router.put('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { status, latitude, longitude, assigned_collector_id, cluster_id, name, max_capacity } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE public.trucks SET
         status                = COALESCE($1, status),
         latitude              = COALESCE($2, latitude),
         longitude             = COALESCE($3, longitude),
         last_seen_at          = CASE WHEN $2 IS NOT NULL THEN NOW() ELSE last_seen_at END,
         assigned_collector_id = COALESCE($4, assigned_collector_id),
         cluster_id            = COALESCE($5, cluster_id),
         name                  = COALESCE($6, name),
         max_capacity          = COALESCE($7, max_capacity)
       WHERE id = $8
       RETURNING *`,
      [status, latitude, longitude, assigned_collector_id, cluster_id, name, max_capacity, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Truck not found.' });
    return res.json({ truck: rows[0] });
  } catch (err) {
    console.error('Update truck error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// DELETE /api/trucks/:id
router.delete('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query('DELETE FROM public.trucks WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Truck not found.' });
    return res.json({ message: 'Truck deleted.' });
  } catch (err) {
    console.error('Delete truck error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

function defaultCapacity(type) {
  return { '10_wheeler': 12000, 'forward_truck': 7000, 'mini_dump_truck': 3500 }[type] ?? 5000;
}

module.exports = router;
