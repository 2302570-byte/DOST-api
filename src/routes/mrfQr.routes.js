/**
 * mrfQr.routes.js — MRF QR Code management endpoints
 *
 * GET    /api/mrf-qr?barangay=<barangay>  — list MRF QR records for a barangay
 * POST   /api/mrf-qr                       — create MRF QR record (signs payload)
 * DELETE /api/mrf-qr/:id                  — delete MRF QR record
 *
 * All endpoints require authentication.
 * PB users are scoped to their own barangay via req.user.barangay.
 */

const express  = require('express');
const router   = express.Router();
const pool     = require('../db');
const { signPayload }      = require('../utils/qrCrypto');
const { authenticate }     = require('../middleware/auth');

// ── GET /api/mrf-qr ───────────────────────────────────────────────────────────
// List MRF QR records. Supports ?barangay= filter.
router.get('/', authenticate, async (req, res) => {
  const { barangay } = req.query;

  try {
    const conditions = [];
    const values     = [];

    if (barangay) {
      values.push(barangay);
      conditions.push(`barangay = $${values.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT id, name, barangay, address, latitude, longitude,
              qr_payload, created_by, created_at
         FROM public.mrf_qr_codes
         ${where}
         ORDER BY created_at DESC`,
      values
    );

    return res.status(200).json({ mrfQrCodes: rows });
  } catch (err) {
    console.error('GET mrf-qr error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── POST /api/mrf-qr ──────────────────────────────────────────────────────────
// Create a new MRF QR record.
// Body: { name, barangay, address?, latitude?, longitude? }
// The barangay in the body must match the authenticated PB user's barangay.
router.post('/', authenticate, async (req, res) => {
  const { name, barangay, address, latitude, longitude } = req.body;

  if (!name || !barangay) {
    return res.status(400).json({ error: 'name and barangay are required.' });
  }

  // Scope check: PB users can only create QRs for their own barangay.
  // Super admins are not restricted.
  if (
    req.user.role === 'punong_barangay' &&
    req.user.barangay &&
    req.user.barangay !== barangay
  ) {
    return res.status(403).json({
      error: 'You can only create MRF QR codes for your own barangay.',
    });
  }

  try {
    // Insert the record first to get the UUID
    const result = await pool.query(
      `INSERT INTO public.mrf_qr_codes
         (name, barangay, address, latitude, longitude, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        name.trim(),
        barangay.trim(),
        address?.trim() || null,
        latitude  != null ? parseFloat(latitude)  : null,
        longitude != null ? parseFloat(longitude) : null,
        req.user.id,
      ]
    );
    const record = result.rows[0];

    // Generate server-signed QR payload (same HMAC-SHA256 pattern as bins)
    const rawPayload = {
      system:      'BE-SMART',
      mrf_id:      record.id,
      name:        record.name,
      barangay:    record.barangay,
      address:     record.address || '',
      latitude:    record.latitude  != null ? Number(record.latitude)  : null,
      longitude:   record.longitude != null ? Number(record.longitude) : null,
    };
    const signedPayload = signPayload(rawPayload);
    const qrPayloadStr  = JSON.stringify(signedPayload);

    await pool.query(
      'UPDATE public.mrf_qr_codes SET qr_payload = $1 WHERE id = $2',
      [qrPayloadStr, record.id]
    );

    return res.status(201).json({
      mrfQrCode: {
        ...record,
        qr_payload: qrPayloadStr,
      },
    });
  } catch (err) {
    console.error('POST mrf-qr error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── DELETE /api/mrf-qr/:id ────────────────────────────────────────────────────
// Delete an MRF QR record entirely.
// PB users can only delete records belonging to their own barangay.
router.delete('/:id', authenticate, async (req, res) => {
  const { id } = req.params;

  try {
    // Fetch the record first to enforce barangay scoping
    const check = await pool.query(
      'SELECT id, barangay FROM public.mrf_qr_codes WHERE id = $1',
      [id]
    );

    if (check.rowCount === 0) {
      return res.status(404).json({ error: 'MRF QR code not found.' });
    }

    const record = check.rows[0];

    if (
      req.user.role === 'punong_barangay' &&
      req.user.barangay &&
      req.user.barangay !== record.barangay
    ) {
      return res.status(403).json({
        error: 'You can only delete MRF QR codes for your own barangay.',
      });
    }

    await pool.query('DELETE FROM public.mrf_qr_codes WHERE id = $1', [id]);

    return res.status(200).json({ message: 'MRF QR code deleted successfully.' });
  } catch (err) {
    console.error('DELETE mrf-qr error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
