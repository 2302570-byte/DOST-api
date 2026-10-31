const express    = require('express');
const router     = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const {
  listCollectors,
  getCollector,
  createCollector,
  updateCollector,
  deleteCollector,
  getSummary,
} = require('../controllers/collectors.controller');

// Only the Collector Admin can manage collector accounts
const CA_ONLY = [authenticate, requireRole('collector_admin')];

// GET    /api/collectors/summary
// Must be registered BEFORE /:id so Express doesn't match "summary" as an id
router.get('/summary', ...CA_ONLY, getSummary);

// GET    /api/collectors
router.get('/',        ...CA_ONLY, listCollectors);

// POST   /api/collectors
router.post('/',       ...CA_ONLY, createCollector);

// GET    /api/collectors/:id
router.get('/:id',     ...CA_ONLY, getCollector);

// PATCH  /api/collectors/:id
router.patch('/:id',   ...CA_ONLY, updateCollector);

// DELETE /api/collectors/:id
router.delete('/:id',  ...CA_ONLY, deleteCollector);

module.exports = router;
