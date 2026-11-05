/**
 * mrf.routes.js — MRF facilities and buyer reservation/bidding endpoints.
 *
 * GET  /api/mrf/facilities              — list active MRF facilities (all authenticated)
 * GET  /api/mrf/reservations            — buyer's own reservation/bid history
 * POST /api/mrf/reservations            — buyer places a bid on a full MRF
 */

const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

// ── GET /api/mrf/facilities ───────────────────────────────────────────────────
// Returns all active MRF facilities. Available to all authenticated users
// (residents, MRF workers, buyers all need the map).
// Query params:
//   status — filter by status ('available' | 'full' | 'reserved' | 'closed')
router.get('/facilities', authenticate, async (req, res) => {
  const { status } = req.query;
  const conditions = ['is_active = true'];
  const values     = [];

  if (status) {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }

  try {
    const { rows } = await pool.query(
      `SELECT
         f.id, f.name, f.barangay, f.address,
         f.latitude, f.longitude, f.status,
         f.capacity_kg, f.starting_bid, f.buyout_price,
         f.created_at, f.updated_at,
         (SELECT MAX(r.bid_amount)
            FROM public.mrf_reservations r
            WHERE r.facility_id = f.id
              AND r.status NOT IN ('cancelled', 'lost')
         ) AS current_highest_bid
       FROM public.mrf_facilities f
       WHERE ${conditions.join(' AND ')}
       ORDER BY f.name ASC`,
      values
    );

    // Normalize numeric fields and format for the mobile map components
    const normalized = rows.map((f) => ({
      id:           f.id,
      name:         f.name,
      barangay:     f.barangay,
      address:      f.address ?? null,
      latitude:     f.latitude     != null ? Number(f.latitude)     : null,
      longitude:    f.longitude    != null ? Number(f.longitude)    : null,
      status:       f.status,
      capacityKg:   f.capacity_kg  != null ? Number(f.capacity_kg)  : null,
      startingBid:  f.starting_bid != null ? `₱${Number(f.starting_bid).toLocaleString()}` : null,
      buyoutPrice:  f.buyout_price != null ? `₱${Number(f.buyout_price).toLocaleString()}` : null,
      startingBidRaw: f.starting_bid != null ? Number(f.starting_bid) : null,
      buyoutPriceRaw: f.buyout_price != null ? Number(f.buyout_price) : null,
      currentHighestBid:    f.current_highest_bid != null ? `₱${Number(f.current_highest_bid).toLocaleString()}` : null,
      currentHighestBidRaw: f.current_highest_bid != null ? Number(f.current_highest_bid) : null,
    }));

    return res.json({ facilities: normalized });
  } catch (err) {
    console.error('getMRFFacilities error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── GET /api/mrf/reservations ─────────────────────────────────────────────────
// Returns the authenticated buyer's reservation/bid history, newest first.
router.get(
  '/reservations',
  authenticate,
  requireRole('mrf_buyer'),
  async (req, res) => {
    const buyerId = req.user.id;

    try {
      const { rows } = await pool.query(
        `SELECT
           r.id,
           r.bid_amount,
           r.material,
           r.weight_kg,
           r.status,
           r.created_at,
           f.id       AS facility_id,
           f.name     AS mrf_name,
           f.barangay,
           (SELECT COUNT(*) FROM public.mrf_reservations
              WHERE facility_id = r.facility_id
                AND created_at::date = r.created_at::date) AS bid_count
         FROM public.mrf_reservations r
         JOIN public.mrf_facilities f ON f.id = r.facility_id
         WHERE r.buyer_id = $1
         ORDER BY r.created_at DESC
         LIMIT 100`,
        [buyerId]
      );

      const fmt = (d) =>
        new Date(d).toLocaleString('en-PH', {
          month: 'short', day: 'numeric', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        });

      const normalized = rows.map((r) => ({
        id:         r.id,
        facilityId: r.facility_id,
        mrfName:    r.mrf_name,
        barangay:   r.barangay,
        material:   r.material   ?? null,
        weightKg:   r.weight_kg  != null ? Number(r.weight_kg) : null,
        bidAmount:  `₱${Number(r.bid_amount).toLocaleString()}`,
        bidAmountRaw: Number(r.bid_amount),
        status:     r.status,
        dateTime:   fmt(r.created_at),
        bids:       Number(r.bid_count),
      }));

      return res.json({ reservations: normalized });
    } catch (err) {
      console.error('getMRFReservations error:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// ── POST /api/mrf/reservations ────────────────────────────────────────────────
// Buyer places a bid on a full MRF facility.
// Body: { facilityId, bidAmount, material?, weightKg? }
router.post(
  '/reservations',
  authenticate,
  requireRole('mrf_buyer'),
  async (req, res) => {
    const buyerId = req.user.id;
    const { facilityId, bidAmount, material, weightKg } = req.body;

    if (!facilityId || !bidAmount) {
      return res.status(400).json({ error: 'facilityId and bidAmount are required.' });
    }

    const parsedBid = parseFloat(bidAmount);
    if (isNaN(parsedBid) || parsedBid <= 0) {
      return res.status(400).json({ error: 'bidAmount must be a positive number.' });
    }

    try {
      // Verify facility exists, is active, and is full (open for bidding)
      const facilityResult = await pool.query(
        `SELECT id, name, status, starting_bid
           FROM public.mrf_facilities
           WHERE id = $1 AND is_active = true`,
        [facilityId]
      );

      if (facilityResult.rowCount === 0) {
        return res.status(404).json({ error: 'MRF facility not found.' });
      }

      const facility = facilityResult.rows[0];

      if (facility.status !== 'full') {
        return res.status(409).json({
          error: `MRF ${facility.name} is not currently open for bidding (status: ${facility.status}).`,
        });
      }

      const startingBid = Number(facility.starting_bid ?? 0);
      if (parsedBid < startingBid) {
        return res.status(400).json({
          error: `Bid must be at least ₱${startingBid.toLocaleString()}.`,
        });
      }

      // Reject the bid if it does not exceed the current highest bid
      const highestResult = await pool.query(
        `SELECT MAX(bid_amount) AS highest
           FROM public.mrf_reservations
           WHERE facility_id = $1
             AND status NOT IN ('cancelled', 'lost')`,
        [facilityId]
      );
      const currentHighest = highestResult.rows[0].highest != null
        ? Number(highestResult.rows[0].highest)
        : 0;

      if (currentHighest > 0 && parsedBid <= currentHighest) {
        return res.status(409).json({
          error: `Your bid must exceed the current highest bid of ₱${currentHighest.toLocaleString()}.`,
        });
      }

      const result = await pool.query(
        `INSERT INTO public.mrf_reservations
           (facility_id, buyer_id, bid_amount, material, weight_kg)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, facility_id, bid_amount, material, weight_kg, status, created_at`,
        [
          facilityId,
          buyerId,
          parsedBid,
          material?.trim() || null,
          weightKg != null ? parseFloat(weightKg) : null,
        ]
      );

      const r = result.rows[0];
      return res.status(201).json({
        message: 'Bid placed successfully.',
        reservation: {
          id:         r.id,
          facilityId: r.facility_id,
          mrfName:    facility.name,
          bidAmount:  `₱${Number(r.bid_amount).toLocaleString()}`,
          bidAmountRaw: Number(r.bid_amount),
          material:   r.material,
          weightKg:   r.weight_kg != null ? Number(r.weight_kg) : null,
          status:     r.status,
          dateTime:   new Date(r.created_at).toLocaleString('en-PH', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
          }),
        },
      });
    } catch (err) {
      console.error('placeBid error:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

module.exports = router;
