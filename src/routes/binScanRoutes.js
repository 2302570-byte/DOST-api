/**
 * binScanRoutes.js — BE-SMART Bin Scan Ingestion
 *
 * POST /api/bins/scan-report
 *   • Verifies HMAC signature on the QR payload
 *   • Guards against double-reporting (FULL / LOCKED bins)
 *   • Runs a DB transaction: update bin → insert scan_log → award eco_points
 *   • Emits a WebSocket event so the admin map updates in real time
 */

const express        = require('express');
const router         = express.Router();
const pool           = require('../db');
const { parseAndVerify } = require('../utils/qrCrypto');

// ── Simple JWT auth middleware (reuse pattern from auth controller) ────────────
const jwt = require('jsonwebtoken');

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

// ── POST /api/bins/scan-report ────────────────────────────────────────────────
router.post('/scan-report', authenticate, async (req, res) => {
  const {
    qr_payload,   // raw JSON string from the scanned QR code
    photo_url,    // optional — uploaded photo URL
    latitude,     // reporter GPS lat
    longitude,    // reporter GPS lng
    notes,        // optional free text
  } = req.body;

  // 1. Validate request body
  if (!qr_payload) {
    return res.status(400).json({ error: 'qr_payload is required.' });
  }

  // 2. Verify HMAC signature
  const { valid, payload, reason } = parseAndVerify(qr_payload);
  if (!valid) {
    return res.status(400).json({ error: `Invalid QR code: ${reason}` });
  }

  const binId     = payload.bin_id;
  const reporterId = req.user.id;

  if (!binId) {
    return res.status(400).json({ error: 'QR payload is missing bin_id.' });
  }

  const client = await pool.connect();

  try {
    // 3. Check current bin status (lock row for update)
    const binResult = await client.query(
      'SELECT id, status FROM public.bins WHERE id = $1 FOR UPDATE',
      [binId]
    );

    if (binResult.rowCount === 0) {
      return res.status(404).json({ error: 'Bin not found.' });
    }

    const bin = binResult.rows[0];

    // 4. Guard — already full or locked
    if (bin.status === 'FULL' || bin.status === 'LOCKED') {
      return res.status(409).json({
        error: `Bin is already ${bin.status}. No action taken.`,
        status: bin.status,
      });
    }

    // 5. Transaction — update bin + log scan + award points
    await client.query('BEGIN');

    // 5a. Mark bin as FULL
    await client.query(
      `UPDATE public.bins
          SET status        = 'FULL',
              fill_photo_url = COALESCE($1, fill_photo_url),
              updated_at    = NOW()
        WHERE id = $2`,
      [photo_url || null, binId]
    );

    // 5b. Insert scan log
    const scanResult = await client.query(
      `INSERT INTO public.scan_logs
         (bin_id, reporter_id, photo_url, latitude, longitude, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, scanned_at`,
      [binId, reporterId, photo_url || null, latitude || null, longitude || null, notes || null]
    );

    // 5c. Award eco_points to reporter
    const ECO_POINTS_PER_REPORT = 10;
    await client.query(
      `UPDATE public.users
          SET eco_points = eco_points + $1
        WHERE id = $2`,
      [ECO_POINTS_PER_REPORT, reporterId]
    );

    await client.query('COMMIT');

    // 6. Emit WebSocket event for admin map (if io is available)
    const io = req.app.get('io');
    if (io) {
      io.emit('bin:status_changed', {
        bin_id:    binId,
        status:    'FULL',
        barangay:  payload.barangay,
        timestamp: new Date().toISOString(),
      });
    }

    return res.status(200).json({
      message:       'Bin scan reported successfully.',
      scan_log_id:   scanResult.rows[0].id,
      scanned_at:    scanResult.rows[0].scanned_at,
      eco_points_awarded: ECO_POINTS_PER_REPORT,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bin scan error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// ── GET /api/bins — list bins (for PB dashboard map) ─────────────────────────
router.get('/', authenticate, async (req, res) => {
  const { barangay, status, waste_type } = req.query;

  try {
    const conditions = [];
    const values     = [];

    if (barangay) {
      values.push(barangay);
      conditions.push(`barangay = $${values.length}`);
    }
    if (status) {
      values.push(status);
      conditions.push(`status = $${values.length}`);
    }
    if (waste_type) {
      values.push(waste_type);
      conditions.push(`waste_type = $${values.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT id, name, street, barangay, barangay_code, cluster_id,
              capacity_tier, capacity_volume_liters, waste_type,
              latitude, longitude, status, fill_photo_url,
              created_at, updated_at
         FROM public.bins
         ${where}
         ORDER BY created_at DESC`,
      values
    );

    return res.status(200).json({ bins: result.rows });
  } catch (err) {
    console.error('Get bins error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── POST /api/bins — create a new bin (PB admin) ──────────────────────────────
router.post('/', authenticate, async (req, res) => {
  const {
    name, street, barangay, barangay_code, cluster_id,
    capacity_tier, capacity_volume_liters, waste_type,
    latitude, longitude, qr_payload,
  } = req.body;

  if (!name || !barangay || !capacity_tier || !waste_type) {
    return res.status(400).json({ error: 'name, barangay, capacity_tier and waste_type are required.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO public.bins
         (name, street, barangay, barangay_code, cluster_id,
          capacity_tier, capacity_volume_liters, waste_type,
          latitude, longitude, qr_payload, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        name, street || null, barangay, barangay_code || null, cluster_id || null,
        capacity_tier, capacity_volume_liters || null, waste_type,
        latitude || null, longitude || null, qr_payload || null, req.user.id,
      ]
    );

    return res.status(201).json({ bin: result.rows[0] });
  } catch (err) {
    console.error('Create bin error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
