const express         = require('express');
const router          = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const {
  listMrfWorkers,
  createMrfWorker,
  updateMrfWorker,
  deleteMrfWorker,
} = require('../controllers/users.controller');

const allowedRoles = ['punong_barangay', 'super_admin'];

// GET    /api/users/mrf-workers
router.get('/',     authenticate, requireRole(...allowedRoles), listMrfWorkers);

// POST   /api/users/mrf-workers
router.post('/',    authenticate, requireRole(...allowedRoles), createMrfWorker);

// PUT    /api/users/mrf-workers/:id
router.put('/:id',  authenticate, requireRole(...allowedRoles), updateMrfWorker);

// DELETE /api/users/mrf-workers/:id
router.delete('/:id', authenticate, requireRole(...allowedRoles), deleteMrfWorker);

module.exports = router;
