const express = require('express');
const db = require('../database');
const { authenticateToken, requireCompany, requirePermission } = require('../middleware/auth');

const router = express.Router();

// Apply authentication and company context to all routes
router.use(authenticateToken);
router.use(requireCompany);

// ===== SALES REPORTS =====

// Gross Profit Report - Only for accountants and business owners
router.get('/sales/gross-profit', requirePermission('REPORTS.PROFIT'), (req, res) => {
  const { startDate, endDate } = req.query;
  const companyId = req.user.companyId;

  let query = `
    SELECT
      s.created_at,
      s.sale_number,
      u.full_name as cashier,
      SUM(si.quantity * si.unit_price) as subtotal,
      SUM(s.vat_amount) as vat,
      s.total_amount,
      SUM((si.unit_price - p.cost_price) * si.quantity) as gross_profit,
      ROUND(100.0 * SUM((si.unit_price - p.cost_price) * si.quantity) / SUM(si.total_price), 2) as profit_margin
    FROM sales s
    JOIN sale_items si ON s.id = si.sale_id
    JOIN products p ON si.product_id = p.id
    JOIN users u ON s.user_id = u.id
    WHERE s.company_id = ?
  `;

  const params = [companyId];

  if (startDate) {
    query += ' AND DATE(s.created_at) >= ?';
    params.push(startDate);
  }

  if (endDate) {
    query += ' AND DATE(s.created_at) <= ?';
    params.push(endDate);
  }

  query += ' GROUP BY s.id ORDER BY s.created_at DESC';

  db.all(query, params, (err, sales) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    const totalProfit = sales.reduce((sum, s) => sum + (s.gross_profit || 0), 0);
    const totalSales = sales.reduce((sum, s) => sum + (s.total_amount || 0), 0);

    res.json({
      sales,
      summary: {
        totalSales,
        totalProfit,
        profitMargin: totalSales > 0 ? ((totalProfit / totalSales) * 100).toFixed(2) : 0,
        transactionCount: sales.length
      }
    });
  });
});

// Gross Profit by Salesperson - Only for accountants and business owners
router.get('/sales/gross-profit-by-person', requirePermission('REPORTS.PROFIT'), (req, res) => {
  const { startDate, endDate } = req.query;
  const companyId = req.user.companyId;

  let query = `
    SELECT
      u.full_name as cashier,
      COUNT(DISTINCT s.id) as sales_count,
      SUM(s.total_amount) as total_sales,
      SUM(s.vat_amount) as total_vat,
      SUM((si.unit_price - p.cost_price) * si.quantity) as gross_profit,
      ROUND(100.0 * SUM((si.unit_price - p.cost_price) * si.quantity) / SUM(si.total_price), 2) as profit_margin
    FROM sales s
    JOIN sale_items si ON s.id = si.sale_id
    JOIN products p ON si.product_id = p.id
    JOIN users u ON s.user_id = u.id
    WHERE s.company_id = ?
  `;

  const params = [companyId];

  if (startDate) {
    query += ' AND DATE(s.created_at) >= ?';
    params.push(startDate);
  }

  if (endDate) {
    query += ' AND DATE(s.created_at) <= ?';
    params.push(endDate);
  }

  query += ' GROUP BY u.id, u.full_name ORDER BY gross_profit DESC';

  db.all(query, params, (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    const totalProfit = data.reduce((sum, d) => sum + (d.gross_profit || 0), 0);
    const totalSales = data.reduce((sum, d) => sum + (d.total_sales || 0), 0);

    res.json({
      data,
      summary: {
        totalSales,
        totalProfit,
        profitMargin: totalSales > 0 ? ((totalProfit / totalSales) * 100).toFixed(2) : 0,
        staffCount: data.length
      }
    });
  });
});

// Gross Profit by Product - Only for accountants and business owners
router.get('/sales/gross-profit-by-product', requirePermission('REPORTS.PROFIT'), (req, res) => {
  const { startDate, endDate } = req.query;
  const companyId = req.user.companyId;

  let query = `
    SELECT
      p.product_code,
      p.product_name,
      p.category,
      SUM(si.quantity) as quantity_sold,
      SUM(si.unit_price * si.quantity) as total_revenue,
      SUM(p.cost_price * si.quantity) as total_cost,
      SUM((si.unit_price - p.cost_price) * si.quantity) as gross_profit,
      ROUND(100.0 * SUM((si.unit_price - p.cost_price) * si.quantity) / SUM(si.total_price), 2) as profit_margin
    FROM sale_items si
    JOIN products p ON si.product_id = p.id
    JOIN sales s ON si.sale_id = s.id
    WHERE s.company_id = ?
  `;

  const params = [companyId];

  if (startDate) {
    query += ' AND DATE(s.created_at) >= ?';
    params.push(startDate);
  }

  if (endDate) {
    query += ' AND DATE(s.created_at) <= ?';
    params.push(endDate);
  }

  query += ' GROUP BY p.id ORDER BY gross_profit DESC';

  db.all(query, params, (err, products) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    const totalProfit = products.reduce((sum, p) => sum + (p.gross_profit || 0), 0);
    const totalRevenue = products.reduce((sum, p) => sum + (p.total_revenue || 0), 0);

    res.json({
      products,
      summary: {
        totalRevenue,
        totalProfit,
        profitMargin: totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(2) : 0,
        productCount: products.length
      }
    });
  });
});

// Daily Sales Summary - Only for accountants and business owners
router.get('/sales/daily-summary', requirePermission('REPORTS.SALES'), (req, res) => {
  const { startDate, endDate } = req.query;
  const companyId = req.user.companyId;

  let query = `
    SELECT
      DATE(s.created_at) as sale_date,
      COUNT(DISTINCT s.id) as transaction_count,
      SUM(s.total_amount) as daily_sales,
      SUM(s.vat_amount) as daily_vat,
      SUM((si.unit_price - p.cost_price) * si.quantity) as daily_profit
    FROM sales s
    JOIN sale_items si ON s.id = si.sale_id
    JOIN products p ON si.product_id = p.id
    WHERE s.company_id = ?
  `;

  const params = [companyId];

  if (startDate) {
    query += ' AND DATE(s.created_at) >= ?';
    params.push(startDate);
  }

  if (endDate) {
    query += ' AND DATE(s.created_at) <= ?';
    params.push(endDate);
  }

  query += ' GROUP BY DATE(s.created_at) ORDER BY sale_date DESC';

  db.all(query, params, (err, days) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    const totalSales = days.reduce((sum, d) => sum + (d.daily_sales || 0), 0);
    const totalVat = days.reduce((sum, d) => sum + (d.daily_vat || 0), 0);
    const totalProfit = days.reduce((sum, d) => sum + (d.daily_profit || 0), 0);

    res.json({
      days,
      summary: {
        totalSales,
        totalVat,
        totalProfit,
        daysCount: days.length,
        avgDailySales: days.length > 0 ? (totalSales / days.length).toFixed(2) : 0
      }
    });
  });
});

// Sales Audit Trail - Only for accountants and business owners
router.get('/sales/audit-trail', requirePermission('REPORTS.AUDIT'), (req, res) => {
  const { startDate, endDate } = req.query;
  const companyId = req.user.companyId;

  let query = `
    SELECT
      s.id,
      s.sale_number,
      s.created_at,
      u.full_name as cashier,
      s.payment_method,
      COUNT(si.id) as item_count,
      SUM(si.quantity) as total_quantity,
      s.subtotal,
      s.vat_amount,
      s.total_amount,
      s.status
    FROM sales s
    JOIN users u ON s.user_id = u.id
    LEFT JOIN sale_items si ON s.id = si.sale_id
    WHERE s.company_id = ?
  `;

  const params = [companyId];

  if (startDate) {
    query += ' AND DATE(s.created_at) >= ?';
    params.push(startDate);
  }

  if (endDate) {
    query += ' AND DATE(s.created_at) <= ?';
    params.push(endDate);
  }

  query += ' GROUP BY s.id ORDER BY s.created_at DESC';

  db.all(query, params, (err, sales) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    res.json({
      sales,
      summary: {
        totalTransactions: sales.length,
        totalAmount: sales.reduce((sum, s) => sum + (s.total_amount || 0), 0),
        paymentMethods: [...new Set(sales.map(s => s.payment_method))]
      }
    });
  });
});

// ===== VAT REPORTS =====

// VAT Report - Detail - Only for accountants and business owners
router.get('/vat/detail', requirePermission('REPORTS.VAT'), (req, res) => {
  const { startDate, endDate } = req.query;
  const companyId = req.user.companyId;

  let query = `
    SELECT
      s.id,
      s.sale_number,
      s.created_at,
      u.full_name as cashier,
      si.product_id,
      p.product_name,
      si.quantity,
      si.unit_price,
      si.total_price as subtotal,
      CASE
        WHEN p.requires_vat = 1 THEN si.total_price * 0.15
        ELSE 0
      END as vat_amount,
      CASE
        WHEN p.requires_vat = 1 THEN si.total_price + (si.total_price * 0.15)
        ELSE si.total_price
      END as total_with_vat,
      p.requires_vat
    FROM sales s
    JOIN sale_items si ON s.id = si.sale_id
    JOIN products p ON si.product_id = p.id
    JOIN users u ON s.user_id = u.id
    WHERE s.company_id = ?
  `;

  const params = [companyId];

  if (startDate) {
    query += ' AND DATE(s.created_at) >= ?';
    params.push(startDate);
  }

  if (endDate) {
    query += ' AND DATE(s.created_at) <= ?';
    params.push(endDate);
  }

  query += ' ORDER BY s.created_at DESC, s.id ASC';

  db.all(query, params, (err, items) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    const totalSubtotal = items.reduce((sum, i) => sum + (i.subtotal || 0), 0);
    const totalVat = items.reduce((sum, i) => sum + (i.vat_amount || 0), 0);
    const totalWithVat = items.reduce((sum, i) => sum + (i.total_with_vat || 0), 0);

    res.json({
      items,
      summary: {
        totalSubtotal,
        totalVat,
        totalWithVat,
        vatableItems: items.filter(i => i.requires_vat === 1).length,
        exemptItems: items.filter(i => i.requires_vat === 0).length
      }
    });
  });
});

// VAT Report - Summary - Only for accountants and business owners
router.get('/vat/summary', requirePermission('REPORTS.VAT'), (req, res) => {
  const { startDate, endDate } = req.query;
  const companyId = req.user.companyId;

  let query = `
    SELECT
      DATE(s.created_at) as report_date,
      SUM(CASE WHEN p.requires_vat = 1 THEN si.total_price ELSE 0 END) as taxable_amount,
      SUM(CASE WHEN p.requires_vat = 1 THEN si.total_price * 0.15 ELSE 0 END) as vat_collected,
      SUM(CASE WHEN p.requires_vat = 0 THEN si.total_price ELSE 0 END) as exempt_amount,
      SUM(si.total_price) as total_sales,
      COUNT(DISTINCT s.id) as transaction_count
    FROM sales s
    JOIN sale_items si ON s.id = si.sale_id
    JOIN products p ON si.product_id = p.id
    WHERE s.company_id = ?
  `;

  const params = [companyId];

  if (startDate) {
    query += ' AND DATE(s.created_at) >= ?';
    params.push(startDate);
  }

  if (endDate) {
    query += ' AND DATE(s.created_at) <= ?';
    params.push(endDate);
  }

  query += ' GROUP BY DATE(s.created_at) ORDER BY report_date DESC';

  db.all(query, params, (err, summary) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    const totalTaxable = summary.reduce((sum, s) => sum + (s.taxable_amount || 0), 0);
    const totalVat = summary.reduce((sum, s) => sum + (s.vat_collected || 0), 0);
    const totalExempt = summary.reduce((sum, s) => sum + (s.exempt_amount || 0), 0);

    res.json({
      summary,
      totals: {
        totalTaxable,
        totalVat,
        totalExempt,
        totalSales: totalTaxable + totalExempt,
        effectiveVatRate: (totalTaxable + totalExempt) > 0 ? ((totalVat / (totalTaxable + totalExempt)) * 100).toFixed(2) : 0
      }
    });
  });
});

// ===== INTEGRATION ENDPOINTS =====

// Get sales for Inventory System (all sold items with quantities)
router.get('/integration/inventory-sync', (req, res) => {
  const { sinceId } = req.query;
  const companyId = req.user.companyId;

  let query = `
    SELECT
      s.id as sale_id,
      s.sale_number,
      s.created_at,
      si.product_id,
      p.product_code,
      p.product_name,
      si.quantity,
      si.unit_price,
      p.cost_price,
      (p.cost_price * si.quantity) as cost_total,
      s.payment_method
    FROM sales s
    JOIN sale_items si ON s.id = si.sale_id
    JOIN products p ON si.product_id = p.id
    WHERE s.status = 'completed' AND s.company_id = ?
  `;

  const params = [companyId];

  if (sinceId) {
    query += ' AND s.id > ?';
    params.push(sinceId);
  }

  query += ' ORDER BY s.id ASC';

  db.all(query, params, (err, items) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    res.json({
      items,
      lastId: items.length > 0 ? items[items.length - 1].sale_id : null,
      count: items.length,
      timestamp: new Date().toISOString()
    });
  });
});

// Get sales for Accounting System (invoice format)
router.get('/integration/accounting-sync', (req, res) => {
  const { sinceId } = req.query;
  const companyId = req.user.companyId;

  let query = `
    SELECT
      s.id as invoice_id,
      s.sale_number as invoice_number,
      s.created_at as invoice_date,
      u.full_name as cashier,
      s.payment_method,
      si.product_id,
      p.product_code,
      p.product_name,
      p.category,
      si.quantity,
      si.unit_price,
      si.total_price as line_subtotal,
      CASE WHEN p.requires_vat = 1 THEN si.total_price * 0.15 ELSE 0 END as line_vat,
      CASE WHEN p.requires_vat = 1 THEN si.total_price + (si.total_price * 0.15) ELSE si.total_price END as line_total,
      s.subtotal,
      s.vat_amount,
      s.total_amount
    FROM sales s
    JOIN sale_items si ON s.id = si.sale_id
    JOIN products p ON si.product_id = p.id
    JOIN users u ON s.user_id = u.id
    WHERE s.status = 'completed' AND s.company_id = ?
  `;

  const params = [companyId];

  if (sinceId) {
    query += ' AND s.id > ?';
    params.push(sinceId);
  }

  query += ' ORDER BY s.id ASC, si.id ASC';

  db.all(query, params, (err, items) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Group by invoice
    const invoices = {};
    items.forEach(item => {
      if (!invoices[item.invoice_id]) {
        invoices[item.invoice_id] = {
          invoice_id: item.invoice_id,
          invoice_number: item.invoice_number,
          invoice_date: item.invoice_date,
          cashier: item.cashier,
          payment_method: item.payment_method,
          subtotal: item.subtotal,
          vat_amount: item.vat_amount,
          total_amount: item.total_amount,
          line_items: []
        };
      }

      invoices[item.invoice_id].line_items.push({
        product_id: item.product_id,
        product_code: item.product_code,
        product_name: item.product_name,
        category: item.category,
        quantity: item.quantity,
        unit_price: item.unit_price,
        line_subtotal: item.line_subtotal,
        line_vat: item.line_vat,
        line_total: item.line_total
      });
    });

    const invoiceList = Object.values(invoices);

    res.json({
      invoices: invoiceList,
      lastId: items.length > 0 ? items[items.length - 1].invoice_id : null,
      count: invoiceList.length,
      timestamp: new Date().toISOString()
    });
  });
});

// Webhook endpoint to track sync status
router.post('/integration/sync-status', (req, res) => {
  const { system, lastSyncId, status, errorMessage } = req.body;
  
  // Log sync status (could be stored in a sync_log table)
  console.log(`[${system}] Sync status: ${status}, lastId: ${lastSyncId}${errorMessage ? ', Error: ' + errorMessage : ''}`);
  
  res.json({
    success: true,
    message: `Sync status received for ${system}`,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
