const bcrypt = require('bcrypt');
const jwt    = require('jsonwebtoken');
const pool   = require('../db');

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
async function login(req, res) {
  const { email, password } = req.body;

  // 1. Basic validation
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    // 2. Look up user by email
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 LIMIT 1',
      [email.trim().toLowerCase()]
    );

    const user = result.rows[0];

    // 3. User not found
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // 4. Account inactive
    if (!user.is_active) {
      return res.status(403).json({ error: 'Your account has been deactivated. Please contact support.' });
    }

    // 5. Compare password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // 6. Sign JWT
    const token = jwt.sign(
      {
        id:   user.id,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // 7. Return token + safe user object (no password hash)
    return res.status(200).json({
      token,
      user: {
        id:        user.id,
        name:      user.name,
        email:     user.email,
        role:      user.role,
        barangay:  user.barangay,
        phone:     user.phone,
      },
    });

  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

module.exports = { login };
