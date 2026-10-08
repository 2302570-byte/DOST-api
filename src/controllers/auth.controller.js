const bcrypt = require('bcrypt');
const jwt    = require('jsonwebtoken');
const pool   = require('../db');

// ─── POST /api/auth/register ──────────────────────────────────────────────────
async function register(req, res) {
  const { name, email, phone, barangay, password, role } = req.body;

  // 1. Validation
  if (!name || !email || !phone || !barangay || !password || !role) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  // Only allow self-registration for resident and mrf_buyer roles
  const ALLOWED_ROLES = ['resident', 'mrf_buyer'];
  if (!ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({ error: 'Invalid role for self-registration.' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    // 2. Check email not already taken
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1 LIMIT 1',
      [normalizedEmail]
    );
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // 3. Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // 4. Insert user
    const result = await pool.query(
      `INSERT INTO users (name, email, phone, barangay, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING id, name, email, role, barangay, phone`,
      [name.trim(), normalizedEmail, phone.trim(), barangay, passwordHash, role]
    );

    const user = result.rows[0];

    // 5. Sign JWT so the user is logged in immediately after registration
    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.status(201).json({ token, user });

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

module.exports = { register, login };
