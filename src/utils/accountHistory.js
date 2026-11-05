// ─── Account History Utility ──────────────────────────────────────────────────
// Helper functions for logging account lifecycle events

const pool = require('../db');

/**
 * Log an account action to the history table
 * @param {string} userId - The user ID whose account was affected
 * @param {string} action - 'created' | 'enabled' | 'disabled' | 'deleted'
 * @param {string} performedBy - The admin user ID who performed the action
 * @param {object} snapshot - Optional snapshot of current state { barangayName, captainName, clusterName }
 * @param {string} details - Optional additional details
 */
async function logAccountAction(userId, action, performedBy, snapshot = {}, details = null) {
  try {
    await pool.query(
      `INSERT INTO public.account_history 
       (user_id, action, performed_by, barangay_name, captain_name, cluster_name, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userId,
        action,
        performedBy,
        snapshot.barangayName || null,
        snapshot.captainName || null,
        snapshot.clusterName || null,
        details
      ]
    );
  } catch (err) {
    // Don't throw - logging failure shouldn't break the main operation
    console.error('Failed to log account history:', err);
  }
}

/**
 * Get cluster name for a barangay
 * @param {string} barangayName - The barangay name
 * @returns {Promise<string|null>} The cluster name or null
 */
async function getClusterForBarangay(barangayName) {
  try {
    const result = await pool.query(
      `SELECT c.label 
       FROM public.barangays b
       LEFT JOIN public.cluster_barangays cb ON cb.barangay_id = b.id
       LEFT JOIN public.clusters c ON c.id = cb.cluster_id
       WHERE b.name = $1 AND b.deleted_at IS NULL
       LIMIT 1`,
      [barangayName]
    );
    return result.rows[0]?.label || null;
  } catch (err) {
    console.error('Failed to get cluster for barangay:', err);
    return null;
  }
}

module.exports = {
  logAccountAction,
  getClusterForBarangay
};
