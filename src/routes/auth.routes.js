const express        = require('express');
const router         = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');

// POST /api/auth/register
router.post('/register', authController.register);

// POST /api/auth/login
router.post('/login', authController.login);

// GET /api/auth/me - Get fresh user data (requires auth)
router.get('/me', authenticate, authController.me);

module.exports = router;
