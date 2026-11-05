const express        = require('express');
const router         = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');
const { getMe }      = require('../controllers/users.controller');

// POST /api/auth/register
router.post('/register', authController.register);

// POST /api/auth/login
router.post('/login', authController.login);

// GET /api/auth/me — authenticated user's full profile with role-specific stats
router.get('/me', authenticate, getMe);

module.exports = router;
