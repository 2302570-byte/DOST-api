const express    = require('express');
const router     = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const {
  listUnits,
  getUnit,
  createUnit,
  updateUnit,
  deleteUnit,
  addCollector,
  removeCollector,
  getSummary,
} = require('../controllers/collectorUnits.controller');

// Only the Collector Admin can manage units and assignments
const CA_ONLY = [authenticate, requireRole('collector_admin')];

// GET    /api/collector-units/summary
// Must be registered BEFORE /:id so Express doesn't match "summary" as an id
router.get('/summary', ...CA_ONLY, getSummary);

// GET    /api/collector-units
router.get('/',        ...CA_ONLY, listUnits);

// POST   /api/collector-units
router.post('/',       ...CA_ONLY, createUnit);

// GET    /api/collector-units/:id
router.get('/:id',     ...CA_ONLY, getUnit);

// PATCH  /api/collector-units/:id
router.patch('/:id',   ...CA_ONLY, updateUnit);

// DELETE /api/collector-units/:id
router.delete('/:id',  ...CA_ONLY, deleteUnit);

// POST   /api/collector-units/:id/collectors        — assign a collector
router.post('/:id/collectors',                    ...CA_ONLY, addCollector);

// DELETE /api/collector-units/:id/collectors/:collectorId — unassign a collector
router.delete('/:id/collectors/:collectorId',     ...CA_ONLY, removeCollector);

module.exports = router;
