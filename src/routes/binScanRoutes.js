/**
 * binScanRoutes.js — BE-SMART Bin Management & Scan Ingestion
 *
 * GET    /api/bins                — list bins
 * POST   /api/bins                — create bin
 * DELETE /api/bins/:id            — delete single bin
 * POST   /api/bins/bulk-delete    — delete multiple bins
 * POST   /api/bins/scan-report    — ingest a QR scan
 */

const express            = require('express');
const router             = express.Router();
const pool               = require('../db');
const { parseAndVerify } = require('../utils/qrCrypto');
const jwt                = require('jsonwebtoken');

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

// ── GET /api/bins ─────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  const { barangay, status, tier_id } = req.query;
  try {
    const conditions = [];
    const values     = [];

    if (barangay) { values.push(barangay);  conditions.push(`b.barangay = $${values.length}`); }
    if (status)   { values.push(status);    conditions.push(`b.status = $${values.length}`); }
    if (tier_id)  { values.push(tier_id);   conditions.push(`b.tier_id = $${values.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT b.id, b.name, b.street, b.barangay, b.barangay_code, b.cluster_id,
              b.tier_id, t.name AS tier_name, t.capacity_liters,
              b.sticker_dimensions, b.latitude, b.longitude,
              b.status, b.fill_photo_url, b.qr_payload,
              b.created_at, b.updated_at
         FROM public.bins b
         LEFT JOIN public.tiers t ON t.id = b.tier_id
         ${where}
         ORDER BY b.created_at DESC`,
      values
    );
    return res.status(200).json({ bins: result.rows });
  } catch (err) {
    console.error('Get bins error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── POST /api/bins ────────────────────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  const {
    name, street, barangay, barangay_code, cluster_id,
    tier_id, latitude, longitude, qr_payload,
  } = req.body;

  if (!name || !barangay || !tier_id) {
    return res.status(400).json({ error: 'name, barangay, and tier_id are required.' });
  }

  try {
    // Verify tier exists
    const tierCheck = await pool.query('SELECT id, name, capacity_liters FROM public.tiers WHERE id = $1', [tier_id]);
    if (tierCheck.rowCount === 0) {
      return res.status(400).json({ error: 'Invalid tier_id — tier does not exist.' });
    }

    const result = await pool.query(
      `INSERT INTO public.bins
         (name, street, barangay, barangay_code, cluster_id,
          tier_id, latitude, longitude, qr_payload, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        name, street || null, barangay, barangay_code || null, cluster_id || null,
        tier_id, latitude || null, longitude || null, qr_payload || null, req.user.id,
      ]
    );

    // Return bin with tier info joined
    const bin = { ...result.rows[0], tier_name: tierCheck.rows[0].name, capacity_liters: tierCheck.rows[0].capacity_liters };
    return res.status(201).json({ bin });
  } catch (err) {
    console.error('Create bin error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── DELETE /api/bins/bulk-delete — must be before /:id ───────────────────────
router.post('/bulk-delete', authenticate, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array.' });
  }
  try {
    // Parameterised list: $1, $2, ...
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    const result = await pool.query(
      `DELETE FROM public.bins WHERE id IN (${placeholders}) RETURNING id`,
      ids
    );
    return res.status(200).json({
      message: `${result.rowCount} bin(s) deleted.`,
      deleted_ids: result.rows.map((r) => r.id),
    });
  } catch (err) {
    console.error('Bulk delete error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── DELETE /api/bins/:id ──────────────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'DELETE FROM public.bins WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Bin not found.' });
    }
    return res.status(200).json({ message: 'Bin deleted successfully.' });
  } catch (err) {
    console.error('Delete bin error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── POST /api/bins/scan-report ────────────────────────────────────────────────
router.post('/scan-report', authenticate, async (req, res) => {
  const { qr_payload, photo_url, latitude, longitude, notes } = req.body;

  if (!qr_payload) return res.status(400).json({ error: 'qr_payload is required.' });

  const { valid, payload, reason } = parseAndVerify(qr_payload);
  if (!valid) return res.status(400).json({ error: `Invalid QR code: ${reason}` });

  const binId      = payload.bin_id;
  const reporterId = req.user.id;
  if (!binId) return res.status(400).json({ error: 'QR payload is missing bin_id.' });

  const client = await pool.connect();
  try {
    const binResult = await client.query(
      'SELECT id, status FROM public.bins WHERE id = $1 FOR UPDATE',
      [binId]
    );
    if (binResult.rowCount === 0) return res.status(404).json({ error: 'Bin not found.' });

    const bin = binResult.rows[0];
    if (bin.status === 'FULL' || bin.status === 'LOCKED') {
      return res.status(409).json({ error: `Bin is already ${bin.status}. No action taken.`, status: bin.status });
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE public.bins SET status = 'FULL', fill_photo_url = COALESCE($1, fill_photo_url), updated_at = NOW() WHERE id = $2`,
      [photo_url || null, binId]
    );

    const scanResult = await client.query(
      `INSERT INTO public.scan_logs (bin_id, reporter_id, photo_url, latitude, longitude, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, scanned_at`,
      [binId, reporterId, photo_url || null, latitude || null, longitude || null, notes || null]
    );

    const ECO_POINTS = 10;
    await client.query(
      'UPDATE public.users SET eco_points = eco_points + $1 WHERE id = $2',
      [ECO_POINTS, reporterId]
    );

    await client.query('COMMIT');

    const io = req.app.get('io');
    if (io) io.emit('bin:status_changed', { bin_id: binId, status: 'FULL', barangay: payload.barangay, timestamp: new Date().toISOString() });

    return res.status(200).json({
      message: 'Bin scan reported successfully.',
      scan_log_id: scanResult.rows[0].id,
      scanned_at:  scanResult.rows[0].scanned_at,
      eco_points_awarded: ECO_POINTS,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bin scan error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  } finally {
    client.release();
  }
});

module.exports = router;
