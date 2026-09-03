const jwt = require('jsonwebtoken');

/**
 * Verifies the Bearer JWT issued by /api/auth/login.
 * Attaches { id, role } to req.user on success.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.id, role: payload.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

/**
 * Role guard — use after authenticate().
 * @param {...string} roles - allowed roles e.g. requireRole('mrf_worker')
 *
 * Usage:
 *   router.post('/issue', authenticate, requireRole('mrf_worker'), handler);
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Required role: ${roles.join(' or ')}.`,
      });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
