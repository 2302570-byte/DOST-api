/**
 * collectorReportRoutes.js — BE-SMART Collector Incident Reports
 *
 * POST /api/collector-reports        — collector submits an incident report
 * GET  /api/collector-reports        — collector admin fetches all reports
 * PUT  /api/collector-reports/:id    — collector admin marks a report as resolved
 */

const express  = require('express');
const router   = express.Router();
const pool     = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const VALID_ISSUE_TYPES = [
  'Vehicle Problem',
  'Traffic Jam',
  'Road Closure',
  'Weather Condition',
  'Other',
];

// ── POST /api/collector-reports ───────────────────────────────────────────────
// Collector submits an incident report from the mobile app.
// Body: { issue_type, notes?, stops_completed, stops_total }
router.post(
  '/',
  authenticate,
  requireRole('collector'),
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
         RETURNING *`,
        [
          collectorId,
          issue_type,
          notes?.trim() || null,
          parseInt(stops_completed),
          parseInt(stops_total),
        ]
      );

      return res.status(201).json({
        message: 'Report submitted successfully.',
        report:  result.rows[0],
      });
    } catch (err) {
      console.error('Submit collector report error:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// ── GET /api/collector-reports ────────────────────────────────────────────────
// Collector admin fetches all incident reports.
// Query params: status ('pending' | 'resolved' | all), limit, offset
router.get(
  '/',
  authenticate,
  requireRole('collector_admin'),
  async (req, res) => {
    const { status, limit = 50, offset = 0 } = req.query;

    try {
      const conditions = [];
      const values     = [];

      if (status && ['pending', 'resolved'].includes(status)) {
        values.push(status);
        conditions.push(`cr.status = $${values.length}`);
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      values.push(parseInt(limit));
      values.push(parseInt(offset));

      const { rows } = await pool.query(
        `SELECT
           cr.id,
           cr.issue_type,
           cr.notes,
           cr.stops_completed,
           cr.stops_total,
           cr.status,
           cr.reported_at,
           cr.resolved_at,
           u.name  AS collector_name,
           u.email AS collector_email,
           ru.name AS resolved_by_name
         FROM public.collector_reports cr
         JOIN public.users u   ON u.id  = cr.collector_id
         LEFT JOIN public.users ru ON ru.id = cr.resolved_by
         ${where}
         ORDER BY cr.reported_at DESC
         LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values
      );

      // Total count for pagination
      const countValues = conditions.length ? [values[0]] : [];
      const countWhere  = conditions.length ? `WHERE cr.status = $1` : '';
      const { rows: countRows } = await pool.query(
        `SELECT COUNT(*) FROM public.collector_reports cr ${countWhere}`,
        countValues
      );

      return res.status(200).json({
        reports: rows,
        total:   parseInt(countRows[0].count),
      });
    } catch (err) {
      console.error('Fetch collector reports error:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// ── PUT /api/collector-reports/:id ────────────────────────────────────────────
// Collector admin marks a report as resolved.
router.put(
  '/:id',
  authenticate,
  requireRole('collector_admin'),
  async (req, res) => {
    const { id }     = req.params;
    const adminId    = req.user.id;

    try {
      const result = await pool.query(
        `UPDATE public.collector_reports
           SET status      = 'resolved',
               resolved_at = NOW(),
               resolved_by = $1
         WHERE id = $2
         RETURNING *`,
        [adminId, id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Report not found.' });
      }

      return res.status(200).json({
        message: 'Report marked as resolved.',
        report:  result.rows[0],
      });
    } catch (err) {
      console.error('Resolve collector report error:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

module.exports = router;
