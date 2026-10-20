const bcrypt = require('bcrypt');
const jwt    = require('jsonwebtoken');
const pool   = require('../db');

// ─── Role mapping ─────────────────────────────────────────────────────────────
// Mobile app sends 'buyer'; the DB enum value is 'mrf_buyer'.
const MOBILE_ROLE_TO_DB = {
  resident: 'resident',
  buyer:    'mrf_buyer',
};

// POST /api/auth/register ──────────────────────────────────────────────────────
async function register(req, res) {
  const { name, email, phone, barangay, password, role } = req.body;

  // 1. Validate required fields
  if (!name || !email || !phone || !barangay || !password || !role) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  // 2. Only allow self-registration for resident and buyer (mrf_buyer)
  const dbRole = MOBILE_ROLE_TO_DB[role];
  if (!dbRole) {
    return res.status(400).json({ error: 'Invalid account type. Must be resident or buyer.' });
  }

  // 3. Basic email format check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  // 4. Password length
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    // 5. Check for duplicate email
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1 LIMIT 1',
      [email.trim().toLowerCase()]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // 6. Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // 7. Insert user
    const result = await pool.query(
      `INSERT INTO users (name, email, phone, barangay, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, phone, barangay, role, created_at`,
      [
        name.trim(),
        email.trim().toLowerCase(),
        phone.trim(),
        barangay.trim(),
        password_hash,
        dbRole,
      ]
    );

    const user = result.rows[0];

    // 8. Seed a zero ECO balance row for the new user
    await pool.query(
      'INSERT INTO user_eco_balances (user_id, balance) VALUES ($1, 0)',
      [user.id]
    );

    // 9. Sign JWT (same shape as login)
    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // 10. Return token + safe user object
    return res.status(201).json({
      token,
      user: {
        id:       user.id,
        name:     user.name,
        email:    user.email,
        role:     user.role,
        barangay: user.barangay,
        phone:    user.phone,
      },
    });

  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

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

module.exports = { login, register };
