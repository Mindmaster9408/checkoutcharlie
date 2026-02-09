/**
 * ============================================================================
 * Forensic Audit Routes - Comprehensive Audit Trail
 * ============================================================================
 * Provides audit log viewing, reporting, and suspicious activity detection.
 * Includes both legacy audit_trail and new forensic audit_log endpoints.
 * ============================================================================
 */

const express = require('express');
const db = require('../database');
const { authenticateToken, requireCompany, requirePermission } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

const router = express.Router();

// Apply authentication and company context to all routes
router.use(authenticateToken);
router.use(requireCompany);

// ========== LEGACY ENDPOINTS (backward compatibility) ==========

// Get legacy audit trail
router.get('/trail', requirePermission('REPORTS.AUDIT'), (req, res) => {
  const { userId, tillSessionId, eventType, startDate, endDate, limit = 100, offset = 0 } = req.query;
  const companyId = req.user.companyId;

  let query = `
    SELECT
      a.id, a.user_id, u.full_name as user_name,
      a.event_type, a.event_category, a.event_data,
      a.ip_address, a.created_at
    FROM audit_trail a
    LEFT JOIN users u ON a.user_id = u.id
    WHERE a.company_id = ?
  `;
  const params = [companyId];

  if (userId) { query += ' AND a.user_id = ?'; params.push(userId); }
  if (tillSessionId) { query += ' AND a.till_session_id = ?'; params.push(tillSessionId); }
  if (eventType) { query += ' AND a.event_type = ?'; params.push(eventType); }
  if (startDate) { query += ' AND a.created_at >= ?'; params.push(startDate); }
  if (endDate) { query += ' AND a.created_at <= ?'; params.push(endDate); }

  query += ` ORDER BY a.created_at DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), parseInt(offset));

  db.all(query, params, (err, entries) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    const parsed = entries.map(e => ({ ...e, event_data: e.event_data ? JSON.parse(e.event_data) : null }));
    res.json({ audit_entries: parsed, total: entries.length, limit: parseInt(limit), offset: parseInt(offset) });
  });
});

// Log legacy audit event (also writes to new forensic audit_log)
router.post('/log', (req, res) => {
  const { eventType, eventCategory, component, eventData, tillSessionId } = req.body;
  if (!eventType) return res.status(400).json({ error: 'eventType is required' });

  const data = JSON.stringify(eventData || {});
  db.run(
    `INSERT INTO audit_trail (company_id, user_id, till_session_id, event_type, event_category, component, event_data, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user.companyId, req.user.userId, tillSessionId || null, eventType, eventCategory || 'general', component || null, data, req.ip],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to log audit event' });
      // Also log to new forensic audit_log
      logAudit(req, eventType, eventCategory || 'system', null, { metadata: eventData || {} });
      res.json({ success: true, audit_id: this.lastID });
    }
  );
});

// ========== NEW FORENSIC AUDIT ENDPOINTS ==========

/**
 * GET /api/audit/forensic
 * Query the forensic audit log with comprehensive filtering
 */
router.get('/forensic', requirePermission('REPORTS.AUDIT'), (req, res) => {
  const { userId, actionType, entityType, entityId, startDate, endDate, limit = 100, offset = 0 } = req.query;
  const companyId = req.user.companyId;

  let query = `
    SELECT 
      a.id, a.company_id, a.user_id, a.user_email, a.action_type,
      a.entity_type, a.entity_id, a.field_name, a.old_value, a.new_value,
      a.ip_address, a.session_id, a.user_agent, a.additional_metadata, a.created_at,
      u.full_name as user_name
    FROM audit_log a
    LEFT JOIN users u ON a.user_id = u.id
    WHERE a.company_id = ?
  `;
  const params = [companyId];

  if (userId) { query += ' AND a.user_id = ?'; params.push(parseInt(userId)); }
  if (actionType) { query += ' AND a.action_type = ?'; params.push(actionType); }
  if (entityType) { query += ' AND a.entity_type = ?'; params.push(entityType); }
  if (entityId) { query += ' AND a.entity_id = ?'; params.push(String(entityId)); }
  if (startDate) { query += ' AND a.created_at >= ?'; params.push(startDate); }
  if (endDate) { query += ' AND a.created_at <= ?'; params.push(endDate); }

  query += ` ORDER BY a.created_at DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), parseInt(offset));

  db.all(query, params, (err, entries) => {
    if (err) return res.status(500).json({ error: 'Database error: ' + err.message });

    const parsed = entries.map(e => ({
      ...e,
      old_value: e.old_value ? tryParseJSON(e.old_value) : null,
      new_value: e.new_value ? tryParseJSON(e.new_value) : null,
      additional_metadata: e.additional_metadata ? tryParseJSON(e.additional_metadata) : {}
    }));

    res.json({
      entries: parsed,
      total: entries.length,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  });
});

/**
 * GET /api/audit/user-activity
 * User Activity Report - everything a specific user did in a date range
 */
router.get('/user-activity', requirePermission('REPORTS.AUDIT'), (req, res) => {
  const { userId, startDate, endDate } = req.query;
  const companyId = req.user.companyId;

  if (!userId) return res.status(400).json({ error: 'userId is required' });

  const dateFilters = [];
  const params = [companyId, parseInt(userId)];
  if (startDate) { dateFilters.push('AND a.created_at >= ?'); params.push(startDate); }
  if (endDate) { dateFilters.push('AND a.created_at <= ?'); params.push(endDate); }

  const query = `
    SELECT 
      a.*, u.full_name as user_name, u.email
    FROM audit_log a
    LEFT JOIN users u ON a.user_id = u.id
    WHERE a.company_id = ?
      AND a.user_id = ?
      ${dateFilters.join(' ')}
    ORDER BY a.created_at DESC
    LIMIT 500
  `;

  db.all(query, params, (err, entries) => {
    if (err) return res.status(500).json({ error: 'Database error' });

    // Build summary
    const summary = { totalActions: entries.length, byType: {} };
    entries.forEach(e => {
      summary.byType[e.action_type] = (summary.byType[e.action_type] || 0) + 1;
    });

    const parsed = entries.map(e => ({
      timestamp: e.created_at,
      action: e.action_type,
      entity: e.entity_type,
      entityId: e.entity_id,
      field: e.field_name,
      oldValue: e.old_value ? tryParseJSON(e.old_value) : null,
      newValue: e.new_value ? tryParseJSON(e.new_value) : null,
      ipAddress: e.ip_address
    }));

    res.json({
      user: entries.length > 0 ? { id: entries[0].user_id, name: entries[0].user_name, email: entries[0].email } : null,
      dateRange: { start: startDate || 'all', end: endDate || 'all' },
      actions: parsed,
      summary
    });
  });
});

/**
 * GET /api/audit/entity-history
 * Entity History Report - all changes to a specific entity
 */
router.get('/entity-history', requirePermission('REPORTS.AUDIT'), (req, res) => {
  const { entityType, entityId } = req.query;
  const companyId = req.user.companyId;

  if (!entityType || !entityId) {
    return res.status(400).json({ error: 'entityType and entityId are required' });
  }

  const query = `
    SELECT 
      a.*, u.full_name as user_name
    FROM audit_log a
    LEFT JOIN users u ON a.user_id = u.id
    WHERE a.company_id = ?
      AND a.entity_type = ?
      AND a.entity_id = ?
    ORDER BY a.created_at DESC
    LIMIT 200
  `;

  db.all(query, [companyId, entityType, String(entityId)], (err, entries) => {
    if (err) return res.status(500).json({ error: 'Database error' });

    const history = entries.map(e => ({
      timestamp: e.created_at,
      action: e.action_type,
      user: e.user_name || e.user_email,
      field: e.field_name,
      oldValue: e.old_value ? tryParseJSON(e.old_value) : null,
      newValue: e.new_value ? tryParseJSON(e.new_value) : null,
      metadata: e.additional_metadata ? tryParseJSON(e.additional_metadata) : {}
    }));

    res.json({
      entity: { type: entityType, id: entityId },
      history
    });
  });
});

/**
 * GET /api/audit/suspicious-activity
 * Suspicious Activity Report - flag potentially fraudulent actions
 */
router.get('/suspicious-activity', requirePermission('REPORTS.AUDIT'), (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const companyId = req.user.companyId;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const query = `
    SELECT 
      a.*, u.full_name as user_name
    FROM audit_log a
    LEFT JOIN users u ON a.user_id = u.id
    WHERE a.company_id = ?
      AND a.created_at >= ?
      AND (
        a.action_type IN ('VOID', 'DELETE', 'LOGIN_FAILED', 'PRICE_CHANGE')
        OR (a.action_type = 'UPDATE' AND a.entity_type = 'product' AND a.field_name = 'unit_price')
        OR (a.action_type = 'DISCOUNT' AND a.entity_type = 'sale')
      )
    ORDER BY a.created_at DESC
    LIMIT 500
  `;

  db.all(query, [companyId, cutoffDate.toISOString()], (err, entries) => {
    if (err) return res.status(500).json({ error: 'Database error' });

    // Analyze patterns
    const alerts = [];
    const userVoids = {};
    const userLoginFails = {};

    entries.forEach(e => {
      if (e.action_type === 'VOID') {
        if (!userVoids[e.user_id]) userVoids[e.user_id] = { count: 0, user: e.user_name, entries: [] };
        userVoids[e.user_id].count++;
        userVoids[e.user_id].entries.push(e);
      }
      if (e.action_type === 'LOGIN_FAILED') {
        const key = e.entity_id || e.ip_address;
        if (!userLoginFails[key]) userLoginFails[key] = { count: 0, entries: [] };
        userLoginFails[key].count++;
        userLoginFails[key].entries.push(e);
      }
    });

    // Flag excessive voids (>=3 in the period)
    Object.entries(userVoids).forEach(([userId, data]) => {
      if (data.count >= 3) {
        alerts.push({
          severity: data.count >= 5 ? 'high' : 'medium',
          type: 'excessive_voids',
          user: data.user,
          userId: parseInt(userId),
          description: `${data.count} voided sales in the last ${days} days`,
          count: data.count
        });
      }
    });

    // Flag excessive login failures (>=5)
    Object.entries(userLoginFails).forEach(([key, data]) => {
      if (data.count >= 5) {
        alerts.push({
          severity: 'high',
          type: 'brute_force_attempt',
          target: key,
          description: `${data.count} failed login attempts for "${key}" in the last ${days} days`,
          count: data.count
        });
      }
    });

    // Flag after-hours price changes (before 6 AM or after 10 PM)
    entries.forEach(e => {
      if (e.action_type === 'UPDATE' && e.entity_type === 'product' && e.field_name === 'unit_price') {
        const hour = new Date(e.created_at).getHours();
        if (hour < 6 || hour >= 22) {
          alerts.push({
            severity: 'medium',
            type: 'after_hours_price_change',
            user: e.user_name,
            description: `Price changed at ${new Date(e.created_at).toLocaleTimeString()}`,
            entityId: e.entity_id
          });
        }
      }
    });

    res.json({
      period: `Last ${days} days`,
      totalSuspiciousEvents: entries.length,
      alerts: alerts.sort((a, b) => (a.severity === 'high' ? -1 : 1)),
      rawEvents: entries.slice(0, 50).map(e => ({
        timestamp: e.created_at,
        action: e.action_type,
        entity: e.entity_type,
        entityId: e.entity_id,
        user: e.user_name,
        details: e.additional_metadata ? tryParseJSON(e.additional_metadata) : {}
      }))
    });
  });
});

/**
 * GET /api/audit/daily-summary
 * Daily Activity Summary - overview of all activity for a day
 */
router.get('/daily-summary', requirePermission('REPORTS.AUDIT'), (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const companyId = req.user.companyId;

  const query = `
    SELECT 
      action_type,
      entity_type,
      COUNT(*) as count,
      COUNT(DISTINCT user_id) as unique_users
    FROM audit_log
    WHERE company_id = ?
      AND DATE(created_at) = ?
    GROUP BY action_type, entity_type
    ORDER BY count DESC
  `;

  db.all(query, [companyId, date], (err, breakdown) => {
    if (err) return res.status(500).json({ error: 'Database error' });

    let totalActions = 0;
    breakdown.forEach(b => { totalActions += parseInt(b.count); });

    // Get hourly activity
    const hourlyQuery = `
      SELECT 
        EXTRACT(HOUR FROM created_at)::integer as hour,
        COUNT(*) as actions
      FROM audit_log
      WHERE company_id = ?
        AND DATE(created_at) = ?
      GROUP BY hour
      ORDER BY hour ASC
    `;

    db.all(hourlyQuery, [companyId, date], (err2, hourly) => {
      res.json({
        date,
        totalActions,
        breakdown: breakdown.map(b => ({
          action: b.action_type,
          entity: b.entity_type,
          count: parseInt(b.count),
          users: parseInt(b.unique_users)
        })),
        hourlyActivity: (hourly || []).map(h => ({
          hour: parseInt(h.hour),
          actions: parseInt(h.actions)
        }))
      });
    });
  });
});

// ========== LEGACY ENDPOINTS (kept for backward compatibility) ==========

router.get('/summary', requirePermission('REPORTS.AUDIT'), (req, res) => {
  const { userId, startDate, endDate } = req.query;
  const companyId = req.user.companyId;

  let query = `
    SELECT event_category, event_type, COUNT(*) as count, DATE(created_at) as date
    FROM audit_trail WHERE company_id = ?
  `;
  const params = [companyId];
  if (userId) { query += ' AND user_id = ?'; params.push(userId); }
  if (startDate) { query += ' AND created_at >= ?'; params.push(startDate); }
  if (endDate) { query += ' AND created_at <= ?'; params.push(endDate); }
  query += ' GROUP BY event_category, event_type, date ORDER BY date DESC, count DESC';

  db.all(query, params, (err, summary) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ summary });
  });
});

router.get('/user-timeline/:userId', requirePermission('REPORTS.AUDIT'), (req, res) => {
  const userId = req.params.userId;
  const { startDate, endDate } = req.query;
  const companyId = req.user.companyId;

  let query = `
    SELECT a.event_type, a.event_category, a.component, a.event_data, a.created_at
    FROM audit_trail a WHERE a.user_id = ? AND a.company_id = ?
  `;
  const params = [userId, companyId];
  if (startDate) { query += ' AND a.created_at >= ?'; params.push(startDate); }
  if (endDate) { query += ' AND a.created_at <= ?'; params.push(endDate); }
  query += ' ORDER BY a.created_at DESC LIMIT 500';

  db.all(query, params, (err, timeline) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    const parsed = timeline.map(e => ({ ...e, event_data: e.event_data ? JSON.parse(e.event_data) : null }));
    res.json({ user_id: userId, timeline: parsed });
  });
});

// ========== HELPER ==========

function tryParseJSON(str) {
  try { return JSON.parse(str); } catch { return str; }
}

module.exports = router;
