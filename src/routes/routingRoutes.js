/**
 * routingRoutes.js — BE-SMART Route Optimization API
 *
 * POST /api/routing/optimize          — trigger CVRP-TW solver (super_admin only)
 * GET  /api/routing/live-route        — current FULL bins ordered for map display
 * GET  /api/routing/routes            — paginated route plan history
 * GET  /api/routing/routes/:id        — single route plan with full stop details
 * PATCH /api/routing/routes/:id/status — update plan status (e.g. sent → in_progress)
 */

'use strict';

const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { handleRouteGeneration, TRUCK_COLORS } = require('../controllers/route.controller');
const { authenticate, requireRole }           = require('../middleware/auth');

// ── POST /api/routing/optimize ───────────────────────────────────────────────
// Triggers the full CVRP-TW pipeline: Mapbox Matrix → OR-Tools → DB persist.
// Restricted to super_admin and collector_admin (who may re-trigger).
router.post(
  '/optimize',
  authenticate,
  requireRole('super_admin', 'collector_admin'),
  async (req, res) => {
    try {
      const result = await handleRouteGeneration(req.user.id);

      if (!result) {
        return res.status(200).json({
          message: 'No FULL bins to collect at this time.',
          routes:  [],
        });
      }

      if (!result.routes || result.routes.length === 0) {
        return res.status(200).json({
          message: `Solver ran but found no feasible routes (status: ${result.status}).`,
          routes:  [],
        });
      }

      // Return a summary the front-end can use immediately
      const summary = result.routes.map((r, idx) => {
        const truck = result.trucks[r.vehicle_index] ?? result.trucks[0];
        const stops = r.stops.map((locIdx) => result.locations[locIdx]);
        const color = TRUCK_COLORS[r.vehicle_index % TRUCK_COLORS.length];

        return {
          vehicle_index: r.vehicle_index,
          truck_id:      truck.id,
          truck_name:    truck.name,
          truck_type:    truck.truck_type,
          color,
          stops: stops.map((loc, s) => ({
            stop_order:     s,
            bin_id:         loc.id,
            name:           loc.name,
            barangay:       loc.barangay,
            lat:            parseFloat(loc.lat),
            lng:            parseFloat(loc.lng),
            is_depot:       loc.is_depot,
            travel_time_sec: s > 0
              ? (result.timeMatrix[r.stops[s - 1]]?.[r.stops[s]] ?? 0)
              : 0,
          })),
          total_load_l: r.total_load ?? 0,
        };
      });

      return res.status(200).json({
        message:  `Routes optimized: ${result.routes.length} vehicle(s), status ${result.status}.`,
        planId:   result.planId,
        routeId:  result.routeId,
        status:   result.status,
        routes:   summary,
      });
    } catch (err) {
      console.error('[/optimize] error:', err.message);
      return res.status(500).json({
        error: `Route optimization failed: ${err.message}`,
      });
    }
  }
);

// ── GET /api/routing/live-route ──────────────────────────────────────────────
// Returns depot + all FULL bins for the live map overlay.
// Accessible to all authenticated users.
router.get('/live-route', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        id, name, street, barangay,
        latitude, longitude, status, is_depot
      FROM public.bins
      WHERE is_depot = true OR status = 'FULL'
      ORDER BY is_depot DESC, barangay ASC, created_at ASC
    `);

    if (rows.length === 0) {
      return res.json({ depot: null, stops: [], route: [] });
    }

    const depot = rows.find((r) => r.is_depot) ?? null;
    const stops = rows.filter((r) => !r.is_depot);
    const route = depot ? [depot, ...stops, depot] : stops;

    return res.json({
      depot,
      stops,
      route: route.map((r) => ({
        id:       r.id,
        name:     r.name,
        barangay: r.barangay,
        lat:      parseFloat(r.latitude),
        lng:      parseFloat(r.longitude),
        is_depot: r.is_depot,
        status:   r.status,
      })),
    });
  } catch (err) {
    console.error('[live-route] error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── GET /api/routing/routes ──────────────────────────────────────────────────
// Paginated route plan history.
// Query params: page (default 1), limit (default 20), status
router.get('/routes', authenticate, async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page  ?? '1', 10));
    const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit ?? '20', 10)));
    const offset = (page - 1) * limit;
    const status = req.query.status ?? null;

    const where  = status ? `WHERE rp.status = $3` : '';
    const params = status ? [limit, offset, status] : [limit, offset];

    const { rows } = await pool.query(
      `SELECT
         rp.id, rp.route_id, rp.algorithm, rp.solver_status,
         rp.total_bins, rp.total_distance_km, rp.total_time_min,
         rp.status, rp.sent_at, rp.created_at,
         u.name  AS created_by_name,
         su.name AS sent_to_name,
         (SELECT COUNT(*) FROM public.route_vehicles rv WHERE rv.route_plan_id = rp.id) AS vehicle_count
       FROM public.route_plans rp
       LEFT JOIN public.users u  ON u.id  = rp.created_by
       LEFT JOIN public.users su ON su.id = rp.sent_to
       ${where}
       ORDER BY rp.created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM public.route_plans ${status ? `WHERE status = $1` : ''}`,
      status ? [status] : []
    );

    return res.json({
      routes:     rows,
      pagination: {
        total: parseInt(countResult.rows[0].total, 10),
        page,
        limit,
        pages: Math.ceil(parseInt(countResult.rows[0].total, 10) / limit),
      },
    });
  } catch (err) {
    console.error('[GET /routes] error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── GET /api/routing/routes/:id ──────────────────────────────────────────────
// Full route plan detail: plan header + per-vehicle routes + per-stop details.
router.get('/routes/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    // Plan header
    const planResult = await pool.query(
      `SELECT
         rp.*,
         u.name  AS created_by_name,
         su.name AS sent_to_name
       FROM public.route_plans rp
       LEFT JOIN public.users u  ON u.id  = rp.created_by
       LEFT JOIN public.users su ON su.id = rp.sent_to
       WHERE rp.id = $1 OR rp.route_id = $1`,
      [id]
    );

    if (planResult.rowCount === 0) {
      return res.status(404).json({ error: 'Route plan not found.' });
    }

    const plan = planResult.rows[0];

    // Vehicles
    const vehiclesResult = await pool.query(
      `SELECT rv.*, t.plate_number
       FROM public.route_vehicles rv
       LEFT JOIN public.trucks t ON t.id = rv.truck_id
       WHERE rv.route_plan_id = $1
       ORDER BY rv.vehicle_index ASC`,
      [plan.id]
    );

    // Stops for each vehicle
    const vehicles = await Promise.all(
      vehiclesResult.rows.map(async (vehicle) => {
        const stopsResult = await pool.query(
          `SELECT *
           FROM public.route_stops
           WHERE route_vehicle_id = $1
           ORDER BY stop_order ASC`,
          [vehicle.id]
        );
        return { ...vehicle, stops: stopsResult.rows };
      })
    );

    return res.json({ plan, vehicles });
  } catch (err) {
    console.error('[GET /routes/:id] error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── PATCH /api/routing/routes/:id/status ────────────────────────────────────
// Update a route plan's lifecycle status.
// e.g. pending → sent, sent → in_progress, in_progress → completed
router.patch(
  '/routes/:id/status',
  authenticate,
  requireRole('super_admin', 'collector_admin'),
  async (req, res) => {
    const { id }     = req.params;
    const { status, sent_to } = req.body;

    const VALID = ['pending', 'sent', 'in_progress', 'completed', 'cancelled'];
    if (!VALID.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID.join(', ')}` });
    }

    try {
      const { rows } = await pool.query(
        `UPDATE public.route_plans
         SET status   = $1,
             sent_to  = COALESCE($2, sent_to),
             sent_at  = CASE WHEN $1 = 'sent' AND sent_at IS NULL THEN NOW() ELSE sent_at END
         WHERE id = $3 OR route_id = $3
         RETURNING *`,
        [status, sent_to ?? null, id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Route plan not found.' });
      }

      return res.json({ plan: rows[0] });
    } catch (err) {
      console.error('[PATCH /routes/:id/status] error:', err.message);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

module.exports = router;
