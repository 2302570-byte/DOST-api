const pool = require('../db');

// ─── Shared collector row shape returned by every unit endpoint ───────────────
// Keeps the response consistent across list, get-one, and assignment endpoints.
function normalizeCollector(row) {
  return {
    id:        row.id,
    name:      row.name,
    email:     row.email,
    isActive:  row.is_active,
    lastLogin: row.last_login ?? null,
  };
}

// ─── GET /api/collector-units ─────────────────────────────────────────────────
// Returns all units with their assigned collectors (names and count).
async function listUnits(req, res) {
  try {
    const unitsResult = await pool.query(
      `SELECT id, name, plate_number, status, created_at, updated_at
         FROM collector_units
         ORDER BY name ASC`
    );

    if (unitsResult.rows.length === 0) {
      return res.json([]);
    }

    // Fetch all members for these units in a single query
    const unitIds    = unitsResult.rows.map((u) => u.id);
    const placeholders = unitIds.map((_, i) => `$${i + 1}`).join(', ');

    const membersResult = await pool.query(
      `SELECT cum.unit_id,
              u.id, u.name, u.email, u.is_active, u.last_login
         FROM collector_unit_members cum
         JOIN users u ON u.id = cum.collector_id
         WHERE cum.unit_id IN (${placeholders})
         ORDER BY u.name ASC`,
      unitIds
    );

    // Group members by unit_id
    const membersByUnit = {};
    for (const row of membersResult.rows) {
      if (!membersByUnit[row.unit_id]) membersByUnit[row.unit_id] = [];
      membersByUnit[row.unit_id].push(normalizeCollector(row));
    }

    const units = unitsResult.rows.map((u) => ({
      id:             u.id,
      name:           u.name,
      plateNumber:    u.plate_number,
      status:         u.status,
      collectors:     membersByUnit[u.id] ?? [],
      collectorCount: (membersByUnit[u.id] ?? []).length,
      createdAt:      u.created_at,
      updatedAt:      u.updated_at,
    }));

    return res.json(units);
  } catch (err) {
    console.error('listUnits error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── GET /api/collector-units/:id ─────────────────────────────────────────────
async function getUnit(req, res) {
  const { id } = req.params;
  try {
    const unitResult = await pool.query(
      `SELECT id, name, plate_number, status, created_at, updated_at
         FROM collector_units
         WHERE id = $1`,
      [id]
    );
    if (unitResult.rows.length === 0) {
      return res.status(404).json({ error: 'Collector unit not found.' });
    }
    const u = unitResult.rows[0];

    const membersResult = await pool.query(
      `SELECT u.id, u.name, u.email, u.is_active, u.last_login
         FROM collector_unit_members cum
         JOIN users u ON u.id = cum.collector_id
         WHERE cum.unit_id = $1
         ORDER BY u.name ASC`,
      [id]
    );

    return res.json({
      id:             u.id,
      name:           u.name,
      plateNumber:    u.plate_number,
      status:         u.status,
      collectors:     membersResult.rows.map(normalizeCollector),
      collectorCount: membersResult.rows.length,
      createdAt:      u.created_at,
      updatedAt:      u.updated_at,
    });
  } catch (err) {
    console.error('getUnit error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── POST /api/collector-units ────────────────────────────────────────────────
// Creates a new unit. Status defaults to 'idle' (DB default; form doesn't ask).
async function createUnit(req, res) {
  const { name, plateNumber } = req.body;

  if (!name || !plateNumber) {
    return res.status(400).json({ error: 'name and plateNumber are required.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO collector_units (name, plate_number)
         VALUES ($1, $2)
         RETURNING id, name, plate_number, status, created_at, updated_at`,
      [name.trim(), plateNumber.trim().toUpperCase()]
    );
    const u = result.rows[0];

    return res.status(201).json({
      id:             u.id,
      name:           u.name,
      plateNumber:    u.plate_number,
      status:         u.status,
      collectors:     [],
      collectorCount: 0,
      createdAt:      u.created_at,
      updatedAt:      u.updated_at,
    });
  } catch (err) {
    if (err.code === '23505') {
      // unique_violation on plate_number
      return res.status(400).json({ error: 'A unit with this plate number already exists.' });
    }
    console.error('createUnit error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── PATCH /api/collector-units/:id ──────────────────────────────────────────
// Partial update: name, plateNumber, and/or status.
async function updateUnit(req, res) {
  const { id } = req.params;
  const { name, plateNumber, status } = req.body;

  if (name === undefined && plateNumber === undefined && status === undefined) {
    return res.status(400).json({ error: 'Provide at least one field to update: name, plateNumber, or status.' });
  }

  const VALID_STATUSES = ['idle', 'en_route', 'at_depot'];
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}.` });
  }

  try {
    // Confirm unit exists
    const existing = await pool.query(
      'SELECT id FROM collector_units WHERE id = $1',
      [id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Collector unit not found.' });
    }

    // Build dynamic SET clause
    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined)        { fields.push(`name = $${idx++}`);         values.push(name.trim()); }
    if (plateNumber !== undefined) { fields.push(`plate_number = $${idx++}`); values.push(plateNumber.trim().toUpperCase()); }
    if (status !== undefined)      { fields.push(`status = $${idx++}`);       values.push(status); }

    values.push(id);

    const result = await pool.query(
      `UPDATE collector_units SET ${fields.join(', ')}
         WHERE id = $${idx}
         RETURNING id, name, plate_number, status, created_at, updated_at`,
      values
    );
    const u = result.rows[0];

    // Return updated unit with its current collectors
    const membersResult = await pool.query(
      `SELECT u.id, u.name, u.email, u.is_active, u.last_login
         FROM collector_unit_members cum
         JOIN users u ON u.id = cum.collector_id
         WHERE cum.unit_id = $1
         ORDER BY u.name ASC`,
      [id]
    );

    return res.json({
      id:             u.id,
      name:           u.name,
      plateNumber:    u.plate_number,
      status:         u.status,
      collectors:     membersResult.rows.map(normalizeCollector),
      collectorCount: membersResult.rows.length,
      createdAt:      u.created_at,
      updatedAt:      u.updated_at,
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'A unit with this plate number already exists.' });
    }
    console.error('updateUnit error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── DELETE /api/collector-units/:id ─────────────────────────────────────────
// Deletes the unit. Members are unassigned (CASCADE on collector_unit_members),
// but the collector user accounts themselves are NOT deleted.
async function deleteUnit(req, res) {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'DELETE FROM collector_units WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Collector unit not found.' });
    }
    return res.json({ message: 'Collector unit deleted. Collectors have been unassigned.' });
  } catch (err) {
    console.error('deleteUnit error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── POST /api/collector-units/:id/collectors ─────────────────────────────────
// Assigns a collector to this unit.
// Rules:
//   - The user must exist and have role = 'collector'
//   - The collector must not already be assigned to any unit
async function addCollector(req, res) {
  const { id: unitId } = req.params;
  const { collectorId } = req.body;

  if (!collectorId) {
    return res.status(400).json({ error: 'collectorId is required.' });
  }

  try {
    // Confirm unit exists
    const unitResult = await pool.query(
      'SELECT id FROM collector_units WHERE id = $1',
      [unitId]
    );
    if (unitResult.rows.length === 0) {
      return res.status(404).json({ error: 'Collector unit not found.' });
    }

    // Confirm collector exists and has the correct role
    const userResult = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND role = 'collector' AND is_active = true`,
      [collectorId]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Collector not found or account inactive.' });
    }

    // Insert — the UNIQUE index on collector_id will reject double-assignment
    await pool.query(
      `INSERT INTO collector_unit_members (unit_id, collector_id)
         VALUES ($1, $2)`,
      [unitId, collectorId]
    );

    // Return the updated unit
    return getUnit({ params: { id: unitId } }, res);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This collector is already assigned to a unit.' });
    }
    console.error('addCollector error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── DELETE /api/collector-units/:id/collectors/:collectorId ──────────────────
// Removes a collector from this unit (unassigns, does not delete the account).
async function removeCollector(req, res) {
  const { id: unitId, collectorId } = req.params;

  try {
    // Confirm unit exists
    const unitResult = await pool.query(
      'SELECT id FROM collector_units WHERE id = $1',
      [unitId]
    );
    if (unitResult.rows.length === 0) {
      return res.status(404).json({ error: 'Collector unit not found.' });
    }

    const result = await pool.query(
      `DELETE FROM collector_unit_members
         WHERE unit_id = $1 AND collector_id = $2
         RETURNING collector_id`,
      [unitId, collectorId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'This collector is not assigned to the unit.' });
    }

    // Return the updated unit
    return getUnit({ params: { id: unitId } }, res);
  } catch (err) {
    console.error('removeCollector error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── GET /api/collector-units/summary ────────────────────────────────────────
// Returns the 4 summary cards:
//   totalUnits, enRoute, idleOrAtDepot, collectorsAssigned
async function getSummary(req, res) {
  try {
    const result = await pool.query(
      `SELECT
         COUNT(*)                                                              AS total_units,
         COUNT(*) FILTER (WHERE status = 'en_route')                          AS en_route,
         COUNT(*) FILTER (WHERE status IN ('idle', 'at_depot'))               AS idle_or_at_depot,
         (SELECT COUNT(*) FROM collector_unit_members)                        AS collectors_assigned
       FROM collector_units`
    );
    const row = result.rows[0];
    return res.json({
      totalUnits:         Number(row.total_units),
      enRoute:            Number(row.en_route),
      idleOrAtDepot:      Number(row.idle_or_at_depot),
      collectorsAssigned: Number(row.collectors_assigned),
    });
  } catch (err) {
    console.error('getSummary (units) error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

module.exports = {
  listUnits,
  getUnit,
  createUnit,
  updateUnit,
  deleteUnit,
  addCollector,
  removeCollector,
  getSummary,
};
