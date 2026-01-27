/**
 * ============================================================================
 * Loss Prevention Routes - Security Alerts & Variance Tracking
 * ============================================================================
 */

const express = require('express');
const db = require('../database');
const { authenticateToken, requireCompany, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);
router.use(requireCompany);

// ========== RULES ==========

router.get('/rules', requirePermission('LOSS_PREVENTION.VIEW_ALERTS'), (req, res) => {
  db.all('SELECT * FROM loss_prevention_rules WHERE company_id = ? ORDER BY rule_name',
    [req.user.companyId], (err, rules) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ rules });
    });
});

router.post('/rules', requirePermission('LOSS_PREVENTION.MANAGE_RULES'), (req, res) => {
  const { rule_name, rule_type, trigger_conditions, severity, notify_roles, auto_lock_user } = req.body;

  if (!rule_name || !rule_type || !trigger_conditions) {
    return res.status(400).json({ error: 'Rule name, type, and trigger conditions required' });
  }

  db.run(`INSERT INTO loss_prevention_rules (company_id, rule_name, rule_type, trigger_conditions, severity, notify_roles, auto_lock_user)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [req.user.companyId, rule_name, rule_type, JSON.stringify(trigger_conditions), severity || 'warning',
     notify_roles ? JSON.stringify(notify_roles) : null, auto_lock_user || 0],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to create rule' });
      res.status(201).json({ success: true, rule_id: this.lastID });
    });
});

router.put('/rules/:id', requirePermission('LOSS_PREVENTION.MANAGE_RULES'), (req, res) => {
  const { id } = req.params;
  const { rule_name, trigger_conditions, severity, notify_roles, is_active } = req.body;

  db.run(`UPDATE loss_prevention_rules SET rule_name = COALESCE(?, rule_name),
    trigger_conditions = COALESCE(?, trigger_conditions), severity = COALESCE(?, severity),
    notify_roles = ?, is_active = COALESCE(?, is_active) WHERE id = ? AND company_id = ?`,
    [rule_name, trigger_conditions ? JSON.stringify(trigger_conditions) : null, severity,
     notify_roles ? JSON.stringify(notify_roles) : null, is_active, id, req.user.companyId],
    (err) => {
      if (err) return res.status(500).json({ error: 'Failed to update rule' });
      res.json({ success: true });
    });
});

router.delete('/rules/:id', requirePermission('LOSS_PREVENTION.MANAGE_RULES'), (req, res) => {
  db.run('UPDATE loss_prevention_rules SET is_active = 0 WHERE id = ? AND company_id = ?',
    [req.params.id, req.user.companyId], (err) => {
      if (err) return res.status(500).json({ error: 'Failed to delete' });
      res.json({ success: true });
    });
});

// ========== ALERTS ==========

router.get('/alerts', requirePermission('LOSS_PREVENTION.VIEW_ALERTS'), (req, res) => {
  const { status, severity, location_id, user_id, limit } = req.query;

  let query = `SELECT lpa.*, lpr.rule_name, lpr.rule_type, u.full_name as triggered_by_name,
    l.location_name, au.full_name as assigned_to_name
    FROM loss_prevention_alerts lpa
    JOIN loss_prevention_rules lpr ON lpa.rule_id = lpr.id
    LEFT JOIN users u ON lpa.triggered_by_user_id = u.id
    LEFT JOIN locations l ON lpa.location_id = l.id
    LEFT JOIN users au ON lpa.assigned_to_user_id = au.id
    WHERE lpa.company_id = ?`;
  const params = [req.user.companyId];

  if (status) { query += ' AND lpa.status = ?'; params.push(status); }
  if (severity) { query += ' AND lpa.severity = ?'; params.push(severity); }
  if (location_id) { query += ' AND lpa.location_id = ?'; params.push(location_id); }
  if (user_id) { query += ' AND lpa.triggered_by_user_id = ?'; params.push(user_id); }

  query += ` ORDER BY lpa.created_at DESC LIMIT ?`;
  params.push(parseInt(limit) || 100);

  db.all(query, params, (err, alerts) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ alerts });
  });
});

router.get('/alerts/:id', requirePermission('LOSS_PREVENTION.VIEW_ALERTS'), (req, res) => {
  db.get(`SELECT lpa.*, lpr.rule_name, lpr.rule_type, u.full_name as triggered_by_name
    FROM loss_prevention_alerts lpa JOIN loss_prevention_rules lpr ON lpa.rule_id = lpr.id
    LEFT JOIN users u ON lpa.triggered_by_user_id = u.id
    WHERE lpa.id = ? AND lpa.company_id = ?`,
    [req.params.id, req.user.companyId], (err, alert) => {
      if (!alert) return res.status(404).json({ error: 'Alert not found' });
      res.json({ alert });
    });
});

router.put('/alerts/:id/assign', requirePermission('LOSS_PREVENTION.INVESTIGATE'), (req, res) => {
  const { assigned_to_user_id } = req.body;
  db.run(`UPDATE loss_prevention_alerts SET assigned_to_user_id = ?, status = 'investigating'
    WHERE id = ? AND company_id = ?`,
    [assigned_to_user_id, req.params.id, req.user.companyId], (err) => {
      if (err) return res.status(500).json({ error: 'Failed to assign' });
      res.json({ success: true });
    });
});

router.put('/alerts/:id/resolve', requirePermission('LOSS_PREVENTION.RESOLVE'), (req, res) => {
  const { resolution_notes, status } = req.body;
  db.run(`UPDATE loss_prevention_alerts SET status = ?, resolution_notes = ?,
    resolved_at = CURRENT_TIMESTAMP, resolved_by_user_id = ?
    WHERE id = ? AND company_id = ?`,
    [status || 'resolved', resolution_notes, req.user.userId, req.params.id, req.user.companyId],
    (err) => {
      if (err) return res.status(500).json({ error: 'Failed to resolve' });
      res.json({ success: true });
    });
});

// ========== VARIANCES ==========

router.get('/variances', requirePermission('LOSS_PREVENTION.VIEW_VARIANCES'), (req, res) => {
  const { location_id, user_id, start_date, end_date } = req.query;

  let query = `SELECT cv.*, u.full_name, u.employee_id, l.location_name
    FROM cash_variances cv
    JOIN users u ON cv.user_id = u.id
    JOIN locations l ON cv.location_id = l.id
    WHERE cv.company_id = ?`;
  const params = [req.user.companyId];

  if (location_id) { query += ' AND cv.location_id = ?'; params.push(location_id); }
  if (user_id) { query += ' AND cv.user_id = ?'; params.push(user_id); }
  if (start_date) { query += ' AND cv.variance_date >= ?'; params.push(start_date); }
  if (end_date) { query += ' AND cv.variance_date <= ?'; params.push(end_date); }

  query += ' ORDER BY cv.variance_date DESC LIMIT 100';

  db.all(query, params, (err, variances) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ variances });
  });
});

router.get('/employee-risk', requirePermission('LOSS_PREVENTION.VIEW_ALERTS'), (req, res) => {
  const { days } = req.query;
  const numDays = parseInt(days) || 30;

  db.all(`SELECT u.id, u.full_name, u.employee_id,
    (SELECT COUNT(*) FROM cash_variances cv WHERE cv.user_id = u.id AND cv.variance_date >= DATE('now', '-' || ? || ' days')) as variance_count,
    (SELECT COALESCE(SUM(ABS(variance_amount)), 0) FROM cash_variances cv WHERE cv.user_id = u.id AND cv.variance_date >= DATE('now', '-' || ? || ' days')) as total_variance,
    (SELECT COUNT(*) FROM sale_returns sr WHERE sr.processed_by_user_id = u.id AND sr.created_at >= datetime('now', '-' || ? || ' days')) as refund_count,
    (SELECT COUNT(*) FROM loss_prevention_alerts lpa WHERE lpa.triggered_by_user_id = u.id AND lpa.created_at >= datetime('now', '-' || ? || ' days')) as alert_count
    FROM users u
    JOIN user_company_access uca ON u.id = uca.user_id AND uca.company_id = ?
    WHERE u.is_active = 1 AND uca.is_active = 1
    HAVING variance_count > 0 OR refund_count > 5 OR alert_count > 0
    ORDER BY (variance_count + alert_count) DESC`,
    [numDays, numDays, numDays, numDays, req.user.companyId], (err, employees) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ high_risk_employees: employees });
    });
});

// ========== TRIGGER ALERT (Internal use) ==========

router.post('/trigger', (req, res) => {
  const { rule_id, triggered_by_user_id, location_id, alert_type, alert_details, transaction_ids } = req.body;

  db.run(`INSERT INTO loss_prevention_alerts (company_id, rule_id, triggered_by_user_id, location_id,
    alert_type, alert_details, transaction_ids, severity)
    SELECT ?, ?, ?, ?, ?, ?, ?, severity FROM loss_prevention_rules WHERE id = ?`,
    [req.user.companyId, rule_id, triggered_by_user_id, location_id, alert_type,
     JSON.stringify(alert_details), transaction_ids ? JSON.stringify(transaction_ids) : null, rule_id],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to trigger alert' });
      res.json({ success: true, alert_id: this.lastID });
    });
});

module.exports = router;
