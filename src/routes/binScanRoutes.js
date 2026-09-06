/**
 * binScanRoutes.js — BE-SMART Bin Management & Scan Flow
 *
 * GET    /api/bins                    — list bins
 * POST   /api/bins                    — create bin (server signs QR payload)
 * DELETE /api/bins/:id                — delete single bin
 * POST   /api/bins/bulk-delete        — delete multiple bins
 * POST   /api/bins/scan-report        — resident scans bin QR → marks FULL, locks to reporter
 * POST   /api/bins/collection-confirm — collector scans bin QR → marks COLLECTED, awards ECO
 */

const express            = require('express');
const router             = express.Router();
const pool               = require('../db');
const { signPayload, parseAndVerify } = require('../utils/qrCrypto');
const { authenticate, requireRole }   = require('../middleware/auth');
const { awardEco }       = require('../blockchain/contract');

// ── GET /api/bins ─────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  const { barangay, status, tier_id } = req.query;
  try {
    const conditions = [];
    const values     = [];

    if (barangay) { values.push(barangay); conditions.push(`b.barangay = $${values.length}`); }
    if (status)   { values.push(status);   conditions.push(`b.status = $${values.length}`); }
    if (tier_id)  { values.push(tier_id);  conditions.push(`b.tier_id = $${values.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT b.id, b.name, b.street, b.barangay, b.barangay_code, b.cluster_id,
              b.tier_id, t.name AS tier_name, t.capacity_liters, t.eco_reward,
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
// Creates a bin and generates a server-signed QR payload stored in qr_payload.
router.post('/', authenticate, async (req, res) => {
  const {
    name, street, barangay, barangay_code, cluster_id,
    tier_id, latitude, longitude,
  } = req.body;

  if (!name || !barangay || !tier_id) {
    return res.status(400).json({ error: 'name, barangay, and tier_id are required.' });
  }

  try {
    const tierCheck = await pool.query(
      'SELECT id, name, capacity_liters, eco_reward FROM public.tiers WHERE id = $1',
      [tier_id]
    );
    if (tierCheck.rowCount === 0) {
      return res.status(400).json({ error: 'Invalid tier_id — tier does not exist.' });
    }
    const tier = tierCheck.rows[0];

    // Insert bin first to get the UUID
    const result = await pool.query(
      `INSERT INTO public.bins
         (name, street, barangay, barangay_code, cluster_id,
          tier_id, latitude, longitude, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        name, street || null, barangay, barangay_code || null, cluster_id || null,
        tier_id, latitude || null, longitude || null, req.user.id,
      ]
    );
    const bin = result.rows[0];

    // Generate and store signed QR payload using the real bin UUID
    const rawPayload = {
      system:   'BE-SMART',
      bin_id:   bin.id,
      name:     bin.name,
      street:   bin.street || '',
      barangay: bin.barangay,
      tier:     tier.name,
    };
    const signedPayload = signPayload(rawPayload);
    const qrPayloadStr  = JSON.stringify(signedPayload);

    await pool.query(
      'UPDATE public.bins SET qr_payload = $1 WHERE id = $2',
      [qrPayloadStr, bin.id]
    );

    return res.status(201).json({
      bin: {
        ...bin,
        qr_payload:      qrPayloadStr,
        tier_name:       tier.name,
        capacity_liters: tier.capacity_liters,
        eco_reward:      tier.eco_reward,
      },
    });
  } catch (err) {
    console.error('Create bin error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── POST /api/bins/bulk-delete — must be before /:id ─────────────────────────
router.post('/bulk-delete', authenticate, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array.' });
  }
  try {
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    const result = await pool.query(
      `DELETE FROM public.bins WHERE id IN (${placeholders}) RETURNING id`,
      ids
    );
    return res.status(200).json({
      message:     `${result.rowCount} bin(s) deleted.`,
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
      'DELETE FROM public.bins WHERE id = $1 RETURNING id', [id]
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
// Step 1: Resident scans the bin QR code.
// - Validates the signed QR payload
// - Rejects if bin is already FULL (another resident scanned it) or COLLECTED
// - Marks bin FULL and stores the reporter's ID in scan_logs
// - Does NOT award ECO yet — that happens when the collector confirms
router.post(
  '/scan-report',
  authenticate,
  requireRole('resident'),
  async (req, res) => {
    const { qr_payload, photo_url, latitude, longitude, notes } = req.body;

    if (!qr_payload) {
      return res.status(400).json({ error: 'qr_payload is required.' });
    }

    const { valid, payload, reason } = parseAndVerify(qr_payload);
    if (!valid) {
      return res.status(400).json({ error: `Invalid QR code: ${reason}` });
    }

    const binId      = payload.bin_id;
    const reporterId = req.user.id;

    if (!binId) {
      return res.status(400).json({ error: 'QR payload is missing bin_id.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock bin row first (separate from JOIN to satisfy PostgreSQL)
      const lockResult = await client.query(
        'SELECT id FROM public.bins WHERE id = $1 FOR UPDATE', [binId]
      );
      if (lockResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Bin not found.' });
      }

      // Now fetch with tier join (no FOR UPDATE here)
      const binResult = await client.query(
        `SELECT b.id, b.name, b.street, b.barangay, b.status,
                t.name AS tier_name, t.eco_reward
           FROM public.bins b
           LEFT JOIN public.tiers t ON t.id = b.tier_id
           WHERE b.id = $1`,
        [binId]
      );

      const bin = binResult.rows[0];

      // State machine checks
      if (bin.status === 'FULL') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error:  'Already scanned by a resident.',
          status: bin.status,
        });
      }
      if (bin.status === 'COLLECTED') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error:  'This bin has already been collected.',
          status: bin.status,
        });
      }
      if (bin.status === 'LOCKED') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error:  'This bin is locked and cannot be reported.',
          status: bin.status,
        });
      }

      await client.query(
        `UPDATE public.bins
           SET status = 'FULL',
               fill_photo_url = COALESCE($1, fill_photo_url),
               updated_at = NOW()
           WHERE id = $2`,
        [photo_url || null, binId]
      );

      // Log the scan (no eco columns yet — those are filled by the collector)
      const scanResult = await client.query(
        `INSERT INTO public.scan_logs
           (bin_id, reporter_id, photo_url, latitude, longitude, notes)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING id, scanned_at`,
        [binId, reporterId, photo_url || null, latitude || null, longitude || null, notes || null]
      );

      await client.query('COMMIT');

      // Notify connected clients (dashboard map updates in real time)
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
        message:        'Bin reported successfully. You will earn ECO when the collector picks it up.',
        scan_log_id:    scanResult.rows[0].id,
        scanned_at:     scanResult.rows[0].scanned_at,
        bin: {
          id:        bin.id,
          name:      bin.name,
          street:    bin.street,
          barangay:  bin.barangay,
          tier:      bin.tier_name,
          eco_reward: bin.eco_reward,  // tells resident how much they'll earn on collection
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Bin scan-report error:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    } finally {
      client.release();
    }
  }
);

// ── POST /api/bins/collection-confirm ────────────────────────────────────────
// Step 2: Collector scans the same bin QR code on collection day.
// - Validates the signed QR payload
// - Rejects if bin is EMPTY (no resident reported it yet)
// - Rejects if bin is already COLLECTED
// - Finds the resident who reported it from scan_logs
// - Awards ECO to that resident (based on tier) via Hedera blockchain
// - Marks bin COLLECTED
router.post(
  '/collection-confirm',
  authenticate,
  requireRole('collector'),
  async (req, res) => {
    const { qr_payload } = req.body;

    if (!qr_payload) {
      return res.status(400).json({ error: 'qr_payload is required.' });
    }

    const { valid, payload, reason } = parseAndVerify(qr_payload);
    if (!valid) {
      return res.status(400).json({ error: `Invalid QR code: ${reason}` });
    }

    const binId      = payload.bin_id;
    const collectorId = req.user.id;

    if (!binId) {
      return res.status(400).json({ error: 'QR payload is missing bin_id.' });
    }

    const client = await pool.connect();
    let scanLogId, residentId, ecoReward, residentName;

    try {
      await client.query('BEGIN');

      // Lock bin row first (separate from JOIN to satisfy PostgreSQL)
      const lockResult = await client.query(
        'SELECT id FROM public.bins WHERE id = $1 FOR UPDATE', [binId]
      );
      if (lockResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Bin not found.' });
      }

      // Fetch bin + tier info (no FOR UPDATE here)
      const binResult = await client.query(
        `SELECT b.id, b.name, b.street, b.barangay, b.status,
                t.name AS tier_name, t.eco_reward
           FROM public.bins b
           LEFT JOIN public.tiers t ON t.id = b.tier_id
           WHERE b.id = $1`,
        [binId]
      );

      const bin = binResult.rows[0];

      // State machine checks
      if (bin.status === 'EMPTY' || bin.status === 'PARTIAL') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error:  'No resident has reported this bin yet.',
          status: bin.status,
        });
      }
      if (bin.status === 'COLLECTED') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error:  'This bin has already been collected.',
          status: bin.status,
        });
      }

      // Find the resident who reported this bin (most recent FULL scan)
      const scanResult = await client.query(
        `SELECT id, reporter_id
           FROM public.scan_logs
           WHERE bin_id = $1
             AND collected_at IS NULL
           ORDER BY scanned_at DESC
           LIMIT 1`,
        [binId]
      );

      if (scanResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'No scan record found for this bin.' });
      }

      scanLogId  = scanResult.rows[0].id;
      residentId = scanResult.rows[0].reporter_id;
      ecoReward  = bin.eco_reward || 0;

      // Get resident name for the response
      const residentResult = await client.query(
        'SELECT name FROM public.users WHERE id = $1',
        [residentId]
      );
      residentName = residentResult.rows[0]?.name ?? 'Resident';

      // Mark bin as COLLECTED
      await client.query(
        `UPDATE public.bins
           SET status = 'COLLECTED', updated_at = NOW()
           WHERE id = $1`,
        [binId]
      );

      // Record collector info on scan_log (pending blockchain)
      await client.query(
        `UPDATE public.scan_logs
           SET collected_by   = $1,
               collected_at   = NOW(),
               eco_awarded    = $2,
               eco_tx_status  = 'pending'
           WHERE id = $3`,
        [collectorId, ecoReward, scanLogId]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('collection-confirm DB error:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    } finally {
      client.release();
    }

    // ── Award ECO on Hedera (outside the DB transaction) ────────────────────
    if (ecoReward > 0) {
      try {
        const reason  = `Bin collection — ${payload.name || binId}`;
        const { txHash } = await awardEco(residentId, ecoReward, reason, scanLogId);

        // Confirm blockchain tx + update cached balance
        await pool.query(
          `UPDATE public.scan_logs
             SET eco_tx_hash = $1, eco_tx_status = 'confirmed'
             WHERE id = $2`,
          [txHash, scanLogId]
        );

        await pool.query(
          `INSERT INTO user_eco_balances (user_id, balance, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (user_id)
           DO UPDATE SET balance = user_eco_balances.balance + $2, updated_at = NOW()`,
          [residentId, ecoReward]
        );

        // Notify connected clients
        const io = require('../index')?.app?.get?.('io');
        if (req.app.get('io')) {
          req.app.get('io').emit('bin:status_changed', {
            bin_id:    binId,
            status:    'COLLECTED',
            barangay:  payload.barangay,
            timestamp: new Date().toISOString(),
          });
        }

        return res.status(200).json({
          message:       'Bin collected. ECO awarded to resident.',
          bin_id:        binId,
          resident_name: residentName,
          eco_awarded:   ecoReward,
          tx_hash:       txHash,
          scan_log_id:   scanLogId,
        });

      } catch (chainErr) {
        // DB is already updated — flag for reconciliation
        await pool.query(
          `UPDATE public.scan_logs SET eco_tx_status = 'failed' WHERE id = $1`,
          [scanLogId]
        );
        console.error('collection-confirm blockchain error:', chainErr);
        return res.status(502).json({
          error:         'Collection confirmed but blockchain transaction failed. ECO will be reconciled.',
          bin_id:        binId,
          resident_name: residentName,
          eco_awarded:   ecoReward,
          scan_log_id:   scanLogId,
        });
      }
    }

    // ecoReward is 0 (bin has no tier) — still confirm collection
    return res.status(200).json({
      message:     'Bin collected.',
      bin_id:      binId,
      eco_awarded: 0,
      scan_log_id: scanLogId,
    });
  }
);

module.exports = router;
