const express      = require('express');
const router       = express.Router();
const rateLimit    = require('express-rate-limit');
const { authenticate, requireRole } = require('../middleware/auth');
const eco          = require('../controllers/eco.controller');

// Throttle ECO issuance — max 60 issues per minute per IP
const issueLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// ─── MRF worker routes ────────────────────────────────────────────────────────

// GET  /api/eco/mrf-transactions
// MRF worker's own issuance history, optional ?filter=today|week
router.get(
  '/mrf-transactions',
  authenticate,
  requireRole('mrf_worker'),
  eco.getMRFTransactions
);

// GET  /api/eco/waste-types
// Returns waste types + ECO-per-kg rates for the MRF scanner UI
router.get(
  '/waste-types',
  authenticate,
  requireRole('mrf_worker'),
  eco.getWasteTypes
);

// POST /api/eco/issue
// MRF worker scans resident QR → submits waste → awards ECO on-chain
router.post(
  '/issue',
  authenticate,
  requireRole('mrf_worker'),
  issueLimiter,
  eco.issueEco
);

// ─── Resident routes ──────────────────────────────────────────────────────────

// GET  /api/eco/balance
// Fast cached ECO balance
router.get(
  '/balance',
  authenticate,
  requireRole('resident'),
  eco.getBalance
);

// GET  /api/eco/balance/verify
// Authoritative on-chain balance (hits Hedera RPC)
router.get(
  '/balance/verify',
  authenticate,
  requireRole('resident'),
  eco.verifyBalance
);

// GET  /api/eco/transactions
// Earned + redeemed history for the logged-in resident
router.get(
  '/transactions',
  authenticate,
  requireRole('resident'),
  eco.getTransactions
);

// GET  /api/eco/rewards
// List active rewards (all authenticated users can browse)
router.get(
  '/rewards',
  authenticate,
  eco.getRewards
);

// POST /api/eco/rewards/:id/redeem
// Resident redeems ECO for a reward
router.post(
  '/rewards/:id/redeem',
  authenticate,
  requireRole('resident'),
  eco.redeemReward
);

module.exports = router;
