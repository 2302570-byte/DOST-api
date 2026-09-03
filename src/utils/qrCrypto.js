/**
 * qrCrypto.js — BE-SMART QR Payload Signing & Verification
 *
 * Uses Node.js built-in `crypto` (no extra dependencies).
 * Keys are deterministically sorted before hashing so the signature
 * matches whether the payload was built on the React web client or here.
 *
 * Required env var: QR_SECRET_KEY
 */

const crypto = require('crypto');

const SECRET = () => {
  const key = process.env.QR_SECRET_KEY;
  if (!key) throw new Error('QR_SECRET_KEY is not set in environment variables.');
  return key;
};

/**
 * Deterministically serialise an object by sorting keys recursively.
 * Strips the `signature` field so signing and verification are consistent.
 */
function canonicalise(obj) {
  const { signature: _omit, ...rest } = obj;

  function sortKeys(val) {
    if (Array.isArray(val))              return val.map(sortKeys);
    if (val !== null && typeof val === 'object') {
      return Object.keys(val)
        .sort()
        .reduce((acc, k) => { acc[k] = sortKeys(val[k]); return acc; }, {});
    }
    return val;
  }

  return JSON.stringify(sortKeys(rest));
}

/**
 * Sign a payload object.
 * Returns a new object with a `signature` field appended.
 *
 * @param {object} payload  — plain JS object (no signature field yet)
 * @returns {object}        — payload + signature
 */
function signPayload(payload) {
  const canonical  = canonicalise(payload);
  const signature  = crypto
    .createHmac('sha256', SECRET())
    .update(canonical)
    .digest('hex');

  return { ...payload, signature };
}

/**
 * Verify a signed payload object.
 * Returns `true` if the signature is valid, `false` otherwise.
 *
 * @param {object} payload  — payload including `signature` field
 * @returns {boolean}
 */
function verifyPayload(payload) {
  const { signature } = payload;
  if (!signature) return false;

  const canonical   = canonicalise(payload);
  const expected    = crypto
    .createHmac('sha256', SECRET())
    .update(canonical)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature,  'hex'),
      Buffer.from(expected,   'hex'),
    );
  } catch {
    return false;
  }
}

/**
 * Parse and verify a raw QR string (JSON).
 * Returns `{ valid: true, payload }` or `{ valid: false, reason }`.
 *
 * @param {string} raw  — JSON string from scanned QR code
 * @returns {{ valid: boolean, payload?: object, reason?: string }}
 */
function parseAndVerify(raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { valid: false, reason: 'Invalid JSON in QR payload.' };
  }

  if (!verifyPayload(payload)) {
    return { valid: false, reason: 'QR signature is invalid or tampered.' };
  }

  return { valid: true, payload };
}

module.exports = { signPayload, verifyPayload, parseAndVerify, canonicalise };
