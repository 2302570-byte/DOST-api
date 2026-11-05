/**
 * collector.routes.js — Mobile-facing endpoints for the collector role.
 *
 * GET  /api/collector/collections          — collector's own bin collection history
 * POST /api/collector/reports              — submit an incident report
 *
 * These complement the admin-only routes in collectors.routes.js and
 * collectorReportRoutes.js, which are used by the web app only.
 */

const express  = require('express');
const router   = express.Router();
const pool     = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

// Convenience guard — every route here requires a collector token
const COLLECTOR = [authenticate, requireRole('collector')];

const VALID_ISSUE_TYPES = [
  'Vehicle Problem',
  'Traffic Jam',
  'Road Closure',
  'Weather Condition',
  'Other',
];

// ── GET /api/collector/collections ───────────────────────────────────────────
// Returns the authenticated collector's bin collection history from scan_logs.
//
// Query params:
//   filter  — 'today' | 'week' | 'all' (default: 'all')
//
// Response shape (array):
//   { id, binId, binName, street, barangay, collectedAt, volumeL, ecoAwarded, status }
router.get(
  '/collections',
  ...COLLECTOR,
  async (req, res) => {
    const collectorId = req.user.id;
    const { filter = 'all' } = req.query;

    const conditions = ['sl.collected_by = $1'];
    const values     = [collectorId];

    if (filter === 'today') {
      conditions.push('sl.collected_at::date = CURRENT_DATE');
    } else if (filter === 'week') {
      conditions.push("sl.collected_at >= date_trunc('week', NOW())");
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    try {
      const { rows } = await pool.query(
        `SELECT
           sl.id,
           sl.bin_id                                         AS bin_id,
           b.name                                            AS bin_name,
           b.street,
           b.barangay,
           sl.collected_at,
           sl.volume_liters,
           sl.eco_awarded,
           sl.eco_tx_status
         FROM public.scan_logs sl
         JOIN public.bins b ON b.id = sl.bin_id
         ${where}
         ORDER BY sl.collected_at DESC
         LIMIT 100`,
        values
      );

      const fmt = (d) =>
        new Date(d).toLocaleString('en-PH', {
          month: 'short', day: 'numeric', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        });

      const normalized = rows.map((r) => ({
        id:          r.id,
        binId:       r.bin_id,
        binName:     r.bin_name,
        street:      r.street      ?? '',
        barangay:    r.barangay    ?? '',
        collectedAt: r.collected_at ? fmt(r.collected_at) : null,
        volumeL:     r.volume_liters != null ? Number(r.volume_liters) : null,
        ecoAwarded:  r.eco_awarded  ?? 0,
        status:      'collected',
      }));

      return res.json(normalized);
    } catch (err) {
      console.error('fetchCollectorCollections error:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// ── POST /api/collector/reports ───────────────────────────────────────────────
// Collector submits an incident report.
// Mirrors the existing POST /api/collector-reports but under the new prefix.
// Body: { issue_type, notes?, stops_completed, stops_total }
router.post(
  '/reports',
  ...COLLECTOR,
  async (req, res) => {
    const { issue_type, notes, stops_completed, stops_total } = req.body;
    const collectorId = req.user.id;

    if (!issue_type) {
      return res.status(400).json({ error: 'issue_type is required.' });
    }
    if (!VALID_ISSUE_TYPES.includes(issue_type)) {
      return res.status(400).json({
        error: `Invalid issue_type. Must be one of: ${VALID_ISSUE_TYPES.join(', ')}.`,
      });
    }
    if (stops_completed === undefined || stops_total === undefined) {
      return res.status(400).json({ error: 'stops_completed and stops_total are required.' });
    }

    try {
      const result = await pool.query(
        `INSERT INTO public.collector_reports
           (collector_id, issue_type, notes, stops_completed, stops_total)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, issue_type, notes, stops_completed, stops_total, status, reported_at`,
        [
          collectorId,
          issue_type,
          notes?.trim() || null,
          parseInt(stops_completed, 10),
          parseInt(stops_total, 10),
        ]
      );

      return res.status(201).json({
        message: 'Report submitted successfully.',
        report:  result.rows[0],
      });
    } catch (err) {
      console.error('submitCollectorReport error:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

module.exports = router;
