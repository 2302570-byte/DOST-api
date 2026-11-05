/**
 * Barangay History Logging Utility
 * Tracks barangay lifecycle events for audit trail
 */

const pool = require('../db.js');

/**
 * Log a barangay lifecycle event to history table
 * @param {Object} params
 * @param {string} params.barangayId - UUID of the barangay
 * @param {string} params.action - 'created' | 'updated' | 'deleted'
 * @param {Object} params.snapshot - Barangay data snapshot
 * @param {string} params.performedBy - UUID of the user who performed the action
 */
async function logBarangayHistory({ barangayId, action, snapshot, performedBy }) {
  try {
    await pool.query(
      `INSERT INTO public.barangay_history 
       (barangay_id, action, snapshot, performed_by, performed_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [barangayId, action, JSON.stringify(snapshot), performedBy]
    );
  } catch (err) {
    console.error(`Failed to log barangay history (${action}):`, err.message);
    // Don't throw - history logging failure shouldn't block the main operation
  }
}

module.exports = { logBarangayHistory };
