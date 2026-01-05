const express = require('express');
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Get audit trail
router.get('/trail', (req, res) => {
  const { userId, tillSessionId, eventType, startDate, endDate, limit = 100, offset = 0 } = req.query;

  let query = `
    SELECT
      a.id,
      a.user_id,
      u.full_name as user_name,
      a.till_session_id,
      a.event_type,
      a.event_category,
      a.component,
      a.event_data,
      a.ip_address,
      a.created_at
    FROM audit_trail a
    LEFT JOIN users u ON a.user_id = u.id
    WHERE 1=1
  `;

  const params = [];

  if (userId) {
    query += ' AND a.user_id = ?';
    params.push(userId);
  }

  if (tillSessionId) {
    query += ' AND a.till_session_id = ?';
    params.push(tillSessionId);
  }

  if (eventType) {
    query += ' AND a.event_type = ?';
    params.push(eventType);
  }

  if (startDate) {
    query += ' AND a.created_at >= ?';
    params.push(startDate);
  }

  if (endDate) {
    query += ' AND a.created_at <= ?';
    params.push(endDate);
  }

  query += ` ORDER BY a.created_at DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), parseInt(offset));

  db.all(query, params, (err, entries) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Parse event_data JSON
    const parsed = entries.map(entry => ({
      ...entry,
      event_data: entry.event_data ? JSON.parse(entry.event_data) : null
    }));

    res.json({
      audit_entries: parsed,
      total: entries.length,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  });
});

// Log audit event
router.post('/log', (req, res) => {
  const { eventType, eventCategory, component, eventData, tillSessionId } = req.body;
  const userId = req.user.userId;

  if (!eventType) {
    return res.status(400).json({ error: 'eventType is required' });
  }

  const data = JSON.stringify(eventData || {});

  db.run(
    `INSERT INTO audit_trail (user_id, till_session_id, event_type, event_category, component, event_data, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, tillSessionId || null, eventType, eventCategory || 'general', component || null, data, req.ip],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to log audit event' });
      }

      res.json({
        success: true,
        audit_id: this.lastID
      });
    }
  );
});

// Get audit summary
router.get('/summary', (req, res) => {
  const { userId, tillSessionId, startDate, endDate } = req.query;

  let query = `
    SELECT
      event_category,
      event_type,
      COUNT(*) as count,
      DATE(created_at) as date
    FROM audit_trail
    WHERE 1=1
  `;

  const params = [];

  if (userId) {
    query += ' AND user_id = ?';
    params.push(userId);
  }

  if (tillSessionId) {
    query += ' AND till_session_id = ?';
    params.push(tillSessionId);
  }

  if (startDate) {
    query += ' AND created_at >= ?';
    params.push(startDate);
  }

  if (endDate) {
    query += ' AND created_at <= ?';
    params.push(endDate);
  }

  query += ' GROUP BY event_category, event_type, date ORDER BY date DESC, count DESC';

  db.all(query, params, (err, summary) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    res.json({ summary });
  });
});

// Get user activity timeline
router.get('/user-timeline/:userId', (req, res) => {
  const userId = req.params.userId;
  const { startDate, endDate } = req.query;

  let query = `
    SELECT
      a.event_type,
      a.event_category,
      a.component,
      a.event_data,
      a.created_at,
      a.till_session_id
    FROM audit_trail a
    WHERE a.user_id = ?
  `;

  const params = [userId];

  if (startDate) {
    query += ' AND a.created_at >= ?';
    params.push(startDate);
  }

  if (endDate) {
    query += ' AND a.created_at <= ?';
    params.push(endDate);
  }

  query += ' ORDER BY a.created_at DESC LIMIT 500';

  db.all(query, params, (err, timeline) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    const parsed = timeline.map(entry => ({
      ...entry,
      event_data: entry.event_data ? JSON.parse(entry.event_data) : null
    }));

    res.json({
      user_id: userId,
      timeline: parsed
    });
  });
});

module.exports = router;
