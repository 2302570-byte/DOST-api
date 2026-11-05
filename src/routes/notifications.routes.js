/**
 * notifications.routes.js — Persistent notification store for all roles.
 *
 * GET  /api/notifications         — fetch the authenticated user's notifications
 * PUT  /api/notifications/:id/read — mark a single notification as read
 * PUT  /api/notifications/read-all — mark all unread notifications as read
 *
 * The notifications table is populated by backend events (e.g. bin status
 * changes, ECO awards, MRF capacity alerts). These routes expose read-access
 * and read-state management to the mobile app.
 */

const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { authenticate } = require('../middleware/auth');

// Every route here requires a valid JWT — no role restriction since all roles
// have notifications.
const AUTH = [authenticate];

// ── GET /api/notifications ────────────────────────────────────────────────────
// Returns the authenticated user's notifications, newest first.
// Query params:
//   limit  — max results (default 50, max 100)
//   unread — 'true' to return only unread notifications
router.get('/', ...AUTH, async (req, res) => {
  const userId = req.user.id;
  const limit  = Math.min(parseInt(req.query.limit ?? '50', 10), 100);
  const unreadOnly = req.query.unread === 'true';

  const conditions = ['user_id = $1'];
  const values     = [userId];

  if (unreadOnly) {
    conditions.push('is_read = false');
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, type, title, body, is_read, created_at
         FROM public.notifications
         WHERE ${conditions.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT $${values.length + 1}`,
      [...values, limit]
    );

    // Normalize to the shape NotificationsModal expects:
    //   { id, type, title, body, read, time }
    const fmt = (d) => {
      const date = new Date(d);
      const now  = new Date();
      const diffMs = now - date;
      const diffH  = diffMs / (1000 * 60 * 60);
      const diffD  = diffH / 24;

      if (diffH < 1)   return 'Just now';
      if (diffH < 24)  return date.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
      if (diffD < 2)   return 'Yesterday';
      return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
    };

    const normalized = rows.map((n) => ({
      id:    n.id,
      type:  n.type,
      title: n.title,
      body:  n.body,
      read:  n.is_read,
      time:  fmt(n.created_at),
    }));

    const unreadCount = rows.filter((n) => !n.is_read).length;

    return res.json({ notifications: normalized, unreadCount });
  } catch (err) {
    console.error('getNotifications error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── PUT /api/notifications/read-all ──────────────────────────────────────────
// Marks all unread notifications for the user as read.
// Must be registered BEFORE /:id/read so Express doesn't match 'read-all' as an id.
router.put('/read-all', ...AUTH, async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query(
      `UPDATE public.notifications
         SET is_read = true
         WHERE user_id = $1 AND is_read = false`,
      [userId]
    );
    return res.json({ updated: result.rowCount });
  } catch (err) {
    console.error('markAllRead error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── PUT /api/notifications/:id/read ──────────────────────────────────────────
// Marks a single notification as read. Only the owning user can mark it.
router.put('/:id/read', ...AUTH, async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE public.notifications
         SET is_read = true
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
      [id, userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Notification not found.' });
    }
    return res.json({ updated: true });
  } catch (err) {
    console.error('markRead error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
