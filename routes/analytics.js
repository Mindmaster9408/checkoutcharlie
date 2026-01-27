/**
 * ============================================================================
 * Analytics Routes - Dashboards, KPIs, and Reporting
 * ============================================================================
 */

const express = require('express');
const db = require('../database');
const { authenticateToken, requireCompany, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);
router.use(requireCompany);

/**
 * GET /api/analytics/dashboard
 * Get main dashboard data
 */
router.get('/dashboard', requirePermission('ANALYTICS.VIEW_DASHBOARD'), (req, res) => {
  const companyId = req.user.companyId;
  const { location_id, period } = req.query;
  const today = new Date().toISOString().split('T')[0];
  const startDate = period === 'week' ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] :
                    period === 'month' ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : today;

  const locationFilter = location_id ? 'AND location_id = ?' : '';
  const params = location_id ? [companyId, startDate, location_id] : [companyId, startDate];

  // Today's sales
  db.get(`SELECT COUNT(*) as transactions, COALESCE(SUM(total_amount), 0) as revenue,
    COALESCE(AVG(total_amount), 0) as avg_transaction FROM sales
    WHERE company_id = ? AND DATE(created_at) = ? AND status = 'completed' ${location_id ? 'AND location_id = ?' : ''}`,
    location_id ? [companyId, today, location_id] : [companyId, today], (err, todaySales) => {

    // Period sales
    db.get(`SELECT COUNT(*) as transactions, COALESCE(SUM(total_amount), 0) as revenue FROM sales
      WHERE company_id = ? AND DATE(created_at) >= ? AND status = 'completed' ${locationFilter}`,
      params, (err, periodSales) => {

      // Top products
      db.all(`SELECT p.product_name, SUM(si.quantity) as qty_sold, SUM(si.total_price) as revenue
        FROM sale_items si JOIN products p ON si.product_id = p.id JOIN sales s ON si.sale_id = s.id
        WHERE s.company_id = ? AND DATE(s.created_at) >= ? AND s.status = 'completed' ${locationFilter}
        GROUP BY p.id ORDER BY revenue DESC LIMIT 5`,
        params, (err, topProducts) => {

        // Payment breakdown
        db.all(`SELECT payment_method, COUNT(*) as count, SUM(total_amount) as total FROM sales
          WHERE company_id = ? AND DATE(created_at) >= ? AND status = 'completed' ${locationFilter}
          GROUP BY payment_method`, params, (err, paymentBreakdown) => {

          // Hourly sales today
          db.all(`SELECT strftime('%H', created_at) as hour, COUNT(*) as transactions, SUM(total_amount) as revenue
            FROM sales WHERE company_id = ? AND DATE(created_at) = ? AND status = 'completed' ${location_id ? 'AND location_id = ?' : ''}
            GROUP BY hour ORDER BY hour`,
            location_id ? [companyId, today, location_id] : [companyId, today], (err, hourlySales) => {

            res.json({
              today: todaySales || { transactions: 0, revenue: 0, avg_transaction: 0 },
              period: periodSales || { transactions: 0, revenue: 0 },
              top_products: topProducts || [],
              payment_breakdown: paymentBreakdown || [],
              hourly_sales: hourlySales || []
            });
          });
        });
      });
    });
  });
});

/**
 * GET /api/analytics/kpis
 * Get KPI summary
 */
router.get('/kpis', requirePermission('ANALYTICS.VIEW_KPIs'), (req, res) => {
  const companyId = req.user.companyId;
  const { location_id, period } = req.query;
  const days = period === 'week' ? 7 : period === 'month' ? 30 : 1;

  const locationFilter = location_id ? 'AND s.location_id = ?' : '';
  const params = location_id ? [companyId, days, location_id] : [companyId, days];

  db.get(`
    SELECT
      COUNT(DISTINCT DATE(s.created_at)) as active_days,
      COUNT(*) as total_transactions,
      COALESCE(SUM(s.total_amount), 0) as total_revenue,
      COALESCE(AVG(s.total_amount), 0) as avg_basket_value,
      COUNT(DISTINCT s.customer_id) as unique_customers,
      COALESCE(SUM(s.total_amount) / COUNT(DISTINCT DATE(s.created_at)), 0) as avg_daily_sales
    FROM sales s
    WHERE s.company_id = ? AND s.created_at >= datetime('now', '-' || ? || ' days') AND s.status = 'completed' ${locationFilter}
  `, params, (err, kpis) => {
    if (err) return res.status(500).json({ error: 'Database error' });

    // Get targets
    db.all('SELECT * FROM kpi_targets WHERE company_id = ? AND (location_id = ? OR location_id IS NULL) AND effective_from <= DATE("now")',
      [companyId, location_id || null], (err, targets) => {
        res.json({ kpis: kpis || {}, targets: targets || [] });
      });
  });
});

/**
 * PUT /api/analytics/kpis/targets
 * Set KPI targets
 */
router.put('/kpis/targets', requirePermission('ANALYTICS.SET_TARGETS'), (req, res) => {
  const companyId = req.user.companyId;
  const { targets } = req.body;

  if (!targets || !Array.isArray(targets)) {
    return res.status(400).json({ error: 'Targets array required' });
  }

  targets.forEach(t => {
    db.run(`INSERT INTO kpi_targets (company_id, location_id, kpi_type, target_value, period_type, effective_from, created_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [companyId, t.location_id, t.kpi_type, t.target_value, t.period_type, t.effective_from, req.user.userId]);
  });

  res.json({ success: true });
});

/**
 * GET /api/analytics/trends
 * Get sales trends
 */
router.get('/trends', requirePermission('ANALYTICS.VIEW_TRENDS'), (req, res) => {
  const companyId = req.user.companyId;
  const { location_id, days } = req.query;
  const numDays = parseInt(days) || 30;

  const locationFilter = location_id ? 'AND location_id = ?' : '';
  const params = location_id ? [companyId, numDays, location_id] : [companyId, numDays];

  db.all(`SELECT DATE(created_at) as date, COUNT(*) as transactions, SUM(total_amount) as revenue,
    AVG(total_amount) as avg_transaction FROM sales
    WHERE company_id = ? AND created_at >= datetime('now', '-' || ? || ' days') AND status = 'completed' ${locationFilter}
    GROUP BY DATE(created_at) ORDER BY date`, params, (err, trends) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ trends });
    });
});

/**
 * GET /api/analytics/locations/compare
 * Compare locations
 */
router.get('/locations/compare', requirePermission('ANALYTICS.VIEW_DASHBOARD'), (req, res) => {
  const companyId = req.user.companyId;
  const { days } = req.query;
  const numDays = parseInt(days) || 7;

  db.all(`SELECT l.id, l.location_name, l.location_type,
    COUNT(s.id) as transactions, COALESCE(SUM(s.total_amount), 0) as revenue,
    COALESCE(AVG(s.total_amount), 0) as avg_transaction
    FROM locations l
    LEFT JOIN sales s ON l.id = s.location_id AND s.created_at >= datetime('now', '-' || ? || ' days') AND s.status = 'completed'
    WHERE l.company_id = ? AND l.is_active = 1
    GROUP BY l.id ORDER BY revenue DESC`,
    [numDays, companyId], (err, comparison) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ comparison });
    });
});

/**
 * GET /api/analytics/employees
 * Employee performance metrics
 */
router.get('/employees', requirePermission('REPORTS.EMPLOYEE_PERFORMANCE'), (req, res) => {
  const companyId = req.user.companyId;
  const { location_id, days } = req.query;

  db.all(`SELECT u.id, u.full_name, u.employee_id,
    COUNT(s.id) as transactions, COALESCE(SUM(s.total_amount), 0) as revenue,
    COALESCE(AVG(s.total_amount), 0) as avg_transaction
    FROM users u
    LEFT JOIN sales s ON u.id = s.user_id AND s.created_at >= datetime('now', '-' || ? || ' days') AND s.status = 'completed'
    JOIN user_company_access uca ON u.id = uca.user_id AND uca.company_id = ?
    WHERE uca.is_active = 1 ${location_id ? 'AND s.location_id = ?' : ''}
    GROUP BY u.id ORDER BY revenue DESC`,
    location_id ? [days || 7, companyId, location_id] : [days || 7, companyId], (err, employees) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ employees });
    });
});

module.exports = router;
