const pool                              = require('../db');
const { awardEco, redeemEco, getOnChainBalance } = require('../blockchain/contract');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse the resident UUID out of the QR value the mobile app generates.
 * Format: "BESMART-RESIDENT-<uuid>"
 */
function parseResidentQR(qrValue) {
  const PREFIX = 'BESMART-RESIDENT-';
  if (!qrValue || !qrValue.startsWith(PREFIX)) return null;
  const id = qrValue.slice(PREFIX.length).trim();
  return id.length > 0 ? id : null;
}

// ─── GET /api/eco/waste-types ─────────────────────────────────────────────────
// Returns waste types with per-kg ECO rates for the MRF scanner UI.
async function getWasteTypes(req, res) {
  try {
    const { rows } = await pool.query(
      'SELECT id, label, eco_per_kg, icon FROM waste_types WHERE is_active = true ORDER BY label'
    );
    res.json(rows);
  } catch (err) {
    console.error('getWasteTypes error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── POST /api/eco/issue ──────────────────────────────────────────────────────
// MRF worker scans a resident QR → submits waste type + weight → awards ECO.
// Body: { qrValue: "BESMART-RESIDENT-<uuid>", wasteTypeId: "<uuid>", weightKg: 2.5 }
async function issueEco(req, res) {
  const { qrValue, wasteTypeId, weightKg } = req.body;
  const mrfWorkerId = req.user.id;

  // ── Validation ──
  if (!qrValue || !wasteTypeId || !weightKg) {
    return res.status(400).json({ error: 'qrValue, wasteTypeId, and weightKg are required.' });
  }
  if (isNaN(weightKg) || Number(weightKg) <= 0) {
    return res.status(400).json({ error: 'weightKg must be a positive number.' });
  }

  // ── Parse resident ID from QR ──
  const residentId = parseResidentQR(qrValue);
  if (!residentId) {
    return res.status(400).json({ error: 'Invalid resident QR code.' });
  }

  try {
    // ── Verify resident exists ──
    // Wrap in try/catch to handle invalid UUID format gracefully
    let residentResult;
    try {
      residentResult = await pool.query(
        "SELECT id, name FROM users WHERE id = $1 AND role = 'resident' AND is_active = true",
        [residentId]
      );
    } catch (dbErr) {
      // PostgreSQL throws 22P02 for invalid UUID format
      return res.status(400).json({ error: 'Invalid resident QR code — unrecognised ID format.' });
    }
    if (residentResult.rowCount === 0) {
      return res.status(404).json({ error: 'Resident not found or account inactive.' });
    }
    const resident = residentResult.rows[0];

    // ── Get waste type + rate ──
    const wasteResult = await pool.query(
      'SELECT id, label, eco_per_kg FROM waste_types WHERE id = $1 AND is_active = true',
      [wasteTypeId]
    );
    if (wasteResult.rowCount === 0) {
      return res.status(404).json({ error: 'Waste type not found.' });
    }
    const wasteType = wasteResult.rows[0];

    // ── Calculate ECO ──
    const ecoAwarded = Math.round(Number(weightKg) * Number(wasteType.eco_per_kg));
    if (ecoAwarded <= 0) {
      return res.status(400).json({ error: 'Calculated ECO amount is zero. Check weight.' });
    }

    // ── Insert pending submission ──
    const submissionResult = await pool.query(
      `INSERT INTO waste_submissions
         (resident_id, mrf_worker_id, waste_type_id, weight_kg, eco_awarded, tx_status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id`,
      [residentId, mrfWorkerId, wasteTypeId, weightKg, ecoAwarded]
    );
    const submissionId = submissionResult.rows[0].id;

    // ── Call blockchain ──
    const reason = `${wasteType.label} ${weightKg} kg`;
    try {
      const { txHash } = await awardEco(residentId, ecoAwarded, reason, submissionId);

      // ── Confirm submission + update cached balance ──
      await pool.query(
        "UPDATE waste_submissions SET tx_hash = $1, tx_status = 'confirmed' WHERE id = $2",
        [txHash, submissionId]
      );
      await pool.query(
        `INSERT INTO user_eco_balances (user_id, balance, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (user_id)
         DO UPDATE SET balance = user_eco_balances.balance + $2, updated_at = now()`,
        [residentId, ecoAwarded]
      );

      return res.status(201).json({
        residentName: resident.name,
        wasteType:    wasteType.label,
        weightKg:     Number(weightKg),
        ecoAwarded,
        txHash,
        submissionId,
      });

    } catch (chainErr) {
      // Submission row stays as 'failed' for reconciliation
      await pool.query(
        "UPDATE waste_submissions SET tx_status = 'failed' WHERE id = $1",
        [submissionId]
      );
      console.error('On-chain award failed:', chainErr);
      return res.status(502).json({
        error: 'ECO reserved but blockchain transaction failed. Please try again.',
        submissionId,
      });
    }

  } catch (err) {
    console.error('issueEco error:', err.message, err.stack);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── GET /api/eco/mrf-transactions ───────────────────────────────────────────
// Transaction history for the logged-in MRF worker — all waste submissions
// they recorded, with resident name and waste type details.
async function getMRFTransactions(req, res) {
  const { filter } = req.query; // 'today' | 'week' | 'all' (default)
  try {
    let dateClause = '';
    if (filter === 'today') {
      dateClause = "AND ws.created_at >= CURRENT_DATE";
    } else if (filter === 'week') {
      dateClause = "AND ws.created_at >= date_trunc('week', CURRENT_DATE)";
    }

    const { rows } = await pool.query(
      `SELECT
         ws.id,
         u.name        AS resident_name,
         u.id          AS resident_id,
         wt.label      AS waste_type,
         ws.weight_kg,
         ws.eco_awarded,
         ws.tx_hash,
         ws.tx_status,
         ws.created_at
       FROM waste_submissions ws
       JOIN users      u  ON u.id  = ws.resident_id
       JOIN waste_types wt ON wt.id = ws.waste_type_id
       WHERE ws.mrf_worker_id = $1
         AND ws.tx_status = 'confirmed'
         ${dateClause}
       ORDER BY ws.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('getMRFTransactions error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
}


// Fast cached balance read for the resident.
async function getBalance(req, res) {
  try {
    const { rows } = await pool.query(
      'SELECT balance, updated_at FROM user_eco_balances WHERE user_id = $1',
      [req.user.id]
    );
    res.json({ balance: rows[0]?.balance ?? 0, updatedAt: rows[0]?.updated_at ?? null });
  } catch (err) {
    console.error('getBalance error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── GET /api/eco/balance/verify ─────────────────────────────────────────────
// Authoritative on-chain balance — slower, hits the Hedera RPC.
async function verifyBalance(req, res) {
  try {
    const onChainBalance = await getOnChainBalance(req.user.id);
    res.json({ onChainBalance });
  } catch (err) {
    console.error('verifyBalance error:', err);
    res.status(500).json({ error: 'Failed to read on-chain balance.' });
  }
}

// ─── GET /api/eco/transactions ────────────────────────────────────────────────
// Transaction history for a resident (earned + redeemed).
async function getTransactions(req, res) {
  try {
    const earned = await pool.query(
      `SELECT
         ws.id,
         'earned'              AS type,
         ws.eco_awarded        AS amount,
         wt.label              AS title,
         ws.weight_kg,
         ws.tx_hash,
         ws.tx_status,
         ws.created_at
       FROM waste_submissions ws
       JOIN waste_types wt ON wt.id = ws.waste_type_id
       WHERE ws.resident_id = $1 AND ws.tx_status = 'confirmed'
       ORDER BY ws.created_at DESC`,
      [req.user.id]
    );

    const redeemed = await pool.query(
      `SELECT
         er.id,
         'redeemed'   AS type,
         er.eco_cost  AS amount,
         r.name       AS title,
         er.tx_hash,
         er.tx_status,
         er.redeemed_at AS created_at
       FROM eco_redemptions er
       JOIN eco_rewards r ON r.id = er.reward_id
       WHERE er.resident_id = $1 AND er.tx_status = 'confirmed'
       ORDER BY er.redeemed_at DESC`,
      [req.user.id]
    );

    res.json({
      earned:   earned.rows,
      redeemed: redeemed.rows,
    });
  } catch (err) {
    console.error('getTransactions error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── GET /api/eco/rewards ─────────────────────────────────────────────────────
// List active rewards available for redemption.
async function getRewards(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, description, category, partner, eco_cost, stock, featured
       FROM eco_rewards
       WHERE is_active = true
       ORDER BY featured DESC, eco_cost ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('getRewards error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── POST /api/eco/rewards/:id/redeem ────────────────────────────────────────
// Resident redeems ECO for a reward.
async function redeemReward(req, res) {
  const { id: rewardId } = req.params;
  const residentId       = req.user.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock reward row
    const rewardResult = await client.query(
      'SELECT * FROM eco_rewards WHERE id = $1 AND is_active = true FOR UPDATE',
      [rewardId]
    );
    if (rewardResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reward not found or inactive.' });
    }
    const reward = rewardResult.rows[0];

    // Check cached balance
    const balResult = await client.query(
      'SELECT balance FROM user_eco_balances WHERE user_id = $1 FOR UPDATE',
      [residentId]
    );
    const currentBalance = Number(balResult.rows[0]?.balance ?? 0);
    if (currentBalance < reward.eco_cost) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error:   'Insufficient ECO balance.',
        balance: currentBalance,
        needed:  reward.eco_cost,
      });
    }

    // Decrement stock if limited
    if (reward.stock !== null) {
      const stockResult = await client.query(
        'UPDATE eco_rewards SET stock = stock - 1 WHERE id = $1 AND stock > 0 RETURNING stock',
        [rewardId]
      );
      if (stockResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Reward is out of stock.' });
      }
    }

    // Deduct cached balance
    await client.query(
      'UPDATE user_eco_balances SET balance = balance - $1, updated_at = now() WHERE user_id = $2',
      [reward.eco_cost, residentId]
    );

    // Insert pending redemption
    const redemptionResult = await client.query(
      `INSERT INTO eco_redemptions (resident_id, reward_id, eco_cost, tx_status)
       VALUES ($1, $2, $3, 'pending') RETURNING id`,
      [residentId, rewardId, reward.eco_cost]
    );

    await client.query('COMMIT');

    const redemptionId = redemptionResult.rows[0].id;

    // ── Call blockchain ──
    try {
      const { txHash } = await redeemEco(residentId, reward.eco_cost, redemptionId);
      await pool.query(
        "UPDATE eco_redemptions SET tx_hash = $1, tx_status = 'confirmed' WHERE id = $2",
        [txHash, redemptionId]
      );
      return res.json({
        rewardName:  reward.name,
        ecoCost:     reward.eco_cost,
        txHash,
        redemptionId,
      });
    } catch (chainErr) {
      await pool.query(
        "UPDATE eco_redemptions SET tx_status = 'failed' WHERE id = $1",
        [redemptionId]
      );
      console.error('On-chain redeem failed:', chainErr);
      return res.status(502).json({
        error: 'Redemption recorded but blockchain transaction failed. Support has been notified.',
        redemptionId,
      });
    }

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('redeemReward error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  } finally {
    client.release();
  }
}

module.exports = {
  getWasteTypes,
  issueEco,
  getMRFTransactions,
  getBalance,
  verifyBalance,
  getTransactions,
  getRewards,
  redeemReward,
};
