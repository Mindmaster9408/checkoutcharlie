/**
 * ============================================================================
 * Customer Management Routes - Enhanced with Loyalty, Credit & Groups
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

// Get all customers (with new fields)
router.get('/', requirePermission('CUSTOMERS.VIEW'), (req, res) => {
  const { active_only, group, has_balance } = req.query;
  const companyId = req.user.companyId;
  let query = 'SELECT * FROM customers WHERE company_id = ?';
  const params = [companyId];

  if (active_only === 'true') { query += ' AND is_active = 1'; }
  if (group) { query += ' AND customer_group = ?'; params.push(group); }
  if (has_balance === 'true') { query += ' AND current_balance > 0'; }

  query += ' ORDER BY name ASC';

  db.all(query, params, (err, customers) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ customers });
  });
});

// Enhanced search - by name, phone, email, customer_number, id_number
router.get('/search', (req, res) => {
  const { q } = req.query;
  const companyId = req.user.companyId;
  const role = req.user.role;

  if (!q || q.trim() === '') return res.json({ customers: [] });

  const searchTerm = `%${q}%`;

  if (role === 'cashier') {
    db.all(
      `SELECT id, name, customer_number, phone, loyalty_points, loyalty_tier, current_balance
       FROM customers
       WHERE company_id = ? AND (name LIKE ? OR phone LIKE ? OR customer_number LIKE ?)
       AND is_active = 1 ORDER BY name ASC LIMIT 20`,
      [companyId, searchTerm, searchTerm, searchTerm],
      (err, customers) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ customers });
      }
    );
  } else {
    db.all(
      `SELECT * FROM customers
       WHERE company_id = ? AND (name LIKE ? OR contact_number LIKE ? OR phone LIKE ? OR email LIKE ? OR company LIKE ? OR customer_number LIKE ? OR id_number LIKE ?)
       AND is_active = 1 ORDER BY name ASC LIMIT 20`,
      [companyId, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm],
      (err, customers) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ customers });
      }
    );
  }
});

// ========== STATIC ROUTES (must be before /:id) ==========

// Get customer group pricing for a product
router.get('/group-pricing/:productId', requirePermission('CUSTOMERS.VIEW'), (req, res) => {
  const { productId } = req.params;
  const companyId = req.user.companyId;

  db.all(
    `SELECT * FROM customer_group_pricing WHERE product_id = ? AND company_id = ? AND is_active = 1`,
    [productId, companyId],
    (err, pricing) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ pricing: pricing || [] });
    }
  );
});

// Set group pricing for a product
router.post('/group-pricing', requirePermission('PRODUCTS.EDIT'), (req, res) => {
  const { productId, customerGroup, discountPercent, fixedPrice } = req.body;
  const companyId = req.user.companyId;

  if (!productId || !customerGroup) return res.status(400).json({ error: 'productId and customerGroup required' });

  db.run(
    `INSERT INTO customer_group_pricing (company_id, product_id, customer_group, discount_percent, fixed_price)
     VALUES (?, ?, ?, ?, ?)`,
    [companyId, productId, customerGroup, discountPercent || null, fixedPrice || null],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to set group pricing' });
      res.json({ success: true, id: this.lastID, message: 'Group pricing set' });
    }
  );
});

// Top customers by spend
router.get('/reports/top-customers', requirePermission('REPORTS.SALES'), (req, res) => {
  const companyId = req.user.companyId;
  const { limit = 20 } = req.query;

  db.all(`
    SELECT c.id, c.name, c.customer_number, c.loyalty_points, c.loyalty_tier, c.current_balance,
           COUNT(s.id) as total_orders,
           COALESCE(SUM(s.total_amount), 0) as lifetime_spend
    FROM customers c
    LEFT JOIN sales s ON c.id = s.customer_id AND s.company_id = c.company_id AND s.voided_at IS NULL
    WHERE c.company_id = ? AND c.is_active = 1
    GROUP BY c.id, c.name, c.customer_number, c.loyalty_points, c.loyalty_tier, c.current_balance
    ORDER BY lifetime_spend DESC
    LIMIT ?
  `, [companyId, parseInt(limit)], (err, customers) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ customers });
  });
});

// Accounts aging report
router.get('/reports/accounts-aging', requirePermission('REPORTS.SALES'), (req, res) => {
  const companyId = req.user.companyId;

  db.all(`
    SELECT id, name, customer_number, current_balance, credit_limit,
           CASE
             WHEN current_balance <= 0 THEN 'current'
             WHEN current_balance <= credit_limit * 0.5 THEN 'normal'
             WHEN current_balance <= credit_limit * 0.8 THEN 'warning'
             ELSE 'overdue'
           END as status
    FROM customers
    WHERE company_id = ? AND current_balance > 0 AND is_active = 1
    ORDER BY current_balance DESC
  `, [companyId], (err, accounts) => {
    if (err) return res.status(500).json({ error: 'Database error' });

    const totalOutstanding = accounts.reduce((sum, a) => sum + parseFloat(a.current_balance), 0);
    res.json({
      accounts,
      summary: {
        totalAccounts: accounts.length,
        totalOutstanding,
        overdue: accounts.filter(a => a.status === 'overdue').length,
        warning: accounts.filter(a => a.status === 'warning').length
      }
    });
  });
});

// ========== PARAMETERIZED ROUTES ==========

// Get single customer with full details
router.get('/:id', requirePermission('CUSTOMERS.VIEW'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  db.get('SELECT * FROM customers WHERE id = ? AND company_id = ?', [id, companyId], (err, customer) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    // Get recent transactions and loyalty history
    db.all(
      `SELECT id, sale_number, total_amount, payment_method, created_at
       FROM sales WHERE customer_id = ? AND company_id = ? ORDER BY created_at DESC LIMIT 10`,
      [id, companyId],
      (err, recentSales) => {
        db.all(
          `SELECT * FROM loyalty_point_transactions
           WHERE customer_id = ? AND company_id = ? ORDER BY created_at DESC LIMIT 20`,
          [id, companyId],
          (err2, loyaltyHistory) => {
            db.all(
              `SELECT * FROM customer_account_transactions
               WHERE customer_id = ? AND company_id = ? ORDER BY created_at DESC LIMIT 20`,
              [id, companyId],
              (err3, accountHistory) => {
                res.json({
                  customer,
                  recentSales: recentSales || [],
                  loyaltyHistory: loyaltyHistory || [],
                  accountHistory: accountHistory || []
                });
              }
            );
          }
        );
      }
    );
  });
});

// Create customer (with new fields)
router.post('/', requirePermission('CUSTOMERS.CREATE'), (req, res) => {
  const {
    name, contact_person, contact_number, email,
    address_line_1, address_line_2, suburb, city, province, postal_code,
    tax_reference, company, customer_type, custom_field, is_active,
    first_name, last_name, phone, date_of_birth, id_number,
    customer_group, credit_limit, marketing_consent, notes
  } = req.body;
  const companyId = req.user.companyId;

  if (!name || name.trim() === '') return res.status(400).json({ error: 'Name is required' });

  // Generate customer number
  const customerNumber = `CUST-${Date.now().toString(36).toUpperCase()}`;

  db.run(
    `INSERT INTO customers
     (company_id, customer_number, name, first_name, last_name, contact_person, contact_number, phone, email,
      address_line_1, address_line_2, suburb, city, province, postal_code,
      tax_reference, company, customer_type, custom_field, is_active,
      date_of_birth, id_number, customer_group, credit_limit, marketing_consent, notes,
      loyalty_points, loyalty_tier, current_balance)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'bronze', 0)`,
    [
      companyId, customerNumber, name, first_name || null, last_name || null,
      contact_person || null, contact_number || null, phone || contact_number || null, email || null,
      address_line_1 || null, address_line_2 || null, suburb || null, city || null,
      province || null, postal_code || null, tax_reference || null, company || null,
      customer_type || 'Cash Sale Customer', custom_field || null, is_active !== false ? 1 : 0,
      date_of_birth || null, id_number || null, customer_group || 'general',
      credit_limit || 0, marketing_consent ? 1 : 0, notes || null
    ],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to create customer' });

      const custId = this.lastID;
      logAudit(req, 'CREATE', 'customer', custId, { metadata: { name, customerNumber } });

      db.get('SELECT * FROM customers WHERE id = ?', [custId], (err, customer) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ customer, message: 'Customer created successfully' });
      });
    }
  );
});

// Update customer (with new fields)
router.put('/:id', requirePermission('CUSTOMERS.EDIT'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const {
    name, contact_person, contact_number, email,
    address_line_1, address_line_2, suburb, city, province, postal_code,
    tax_reference, company, customer_type, custom_field, is_active,
    first_name, last_name, phone, date_of_birth, id_number,
    customer_group, credit_limit, marketing_consent, notes
  } = req.body;

  if (!name || name.trim() === '') return res.status(400).json({ error: 'Name is required' });

  db.run(
    `UPDATE customers
     SET name = ?, first_name = ?, last_name = ?, contact_person = ?, contact_number = ?, phone = ?, email = ?,
         address_line_1 = ?, address_line_2 = ?, suburb = ?, city = ?, province = ?, postal_code = ?,
         tax_reference = ?, company = ?, customer_type = ?, custom_field = ?, is_active = ?,
         date_of_birth = ?, id_number = ?, customer_group = ?, credit_limit = ?,
         marketing_consent = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND company_id = ?`,
    [
      name, first_name || null, last_name || null, contact_person || null,
      contact_number || null, phone || contact_number || null, email || null,
      address_line_1 || null, address_line_2 || null, suburb || null, city || null,
      province || null, postal_code || null, tax_reference || null, company || null,
      customer_type || 'Cash Sale Customer', custom_field || null, is_active !== false ? 1 : 0,
      date_of_birth || null, id_number || null, customer_group || 'general',
      credit_limit || 0, marketing_consent ? 1 : 0, notes || null,
      id, companyId
    ],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to update customer' });
      logAudit(req, 'UPDATE', 'customer', id, { metadata: { name } });
      db.get('SELECT * FROM customers WHERE id = ? AND company_id = ?', [id, companyId], (err, customer) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ customer, message: 'Customer updated successfully' });
      });
    }
  );
});

// Delete customer (soft delete)
router.delete('/:id', requirePermission('CUSTOMERS.DELETE'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  db.run('UPDATE customers SET is_active = 0 WHERE id = ? AND company_id = ?', [id, companyId], function(err) {
    if (err) return res.status(500).json({ error: 'Failed to delete customer' });
    logAudit(req, 'DELETE', 'customer', id, {});
    res.json({ message: 'Customer deleted successfully' });
  });
});

// ========== LOYALTY POINTS ==========

// Earn loyalty points (called after sale)
router.post('/:id/loyalty/earn', (req, res) => {
  const { id } = req.params;
  const { saleId, saleAmount, pointsRate } = req.body;
  const companyId = req.user.companyId;

  if (!saleAmount) return res.status(400).json({ error: 'saleAmount is required' });

  // Default: 1 point per R10 spent
  const rate = pointsRate || 10;
  const pointsEarned = Math.floor(parseFloat(saleAmount) / rate);

  if (pointsEarned <= 0) return res.json({ pointsEarned: 0, message: 'No points earned' });

  db.get('SELECT * FROM customers WHERE id = ? AND company_id = ?', [id, companyId], (err, customer) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const newTotal = (customer.loyalty_points || 0) + pointsEarned;
    const newTier = calculateTier(newTotal);

    db.run(
      'UPDATE customers SET loyalty_points = ?, loyalty_tier = ? WHERE id = ? AND company_id = ?',
      [newTotal, newTier, id, companyId],
      (err) => {
        if (err) return res.status(500).json({ error: 'Failed to update points' });

        db.run(
          `INSERT INTO loyalty_point_transactions (company_id, customer_id, transaction_type, points, balance_after, reference_id, description)
           VALUES (?, ?, 'earn', ?, ?, ?, ?)`,
          [companyId, id, pointsEarned, newTotal, saleId ? String(saleId) : null, `Earned from sale - R${saleAmount}`]
        );

        logAudit(req, 'LOYALTY_EARN', 'customer', id, { metadata: { pointsEarned, newTotal, saleId } });

        res.json({
          pointsEarned,
          totalPoints: newTotal,
          tier: newTier,
          message: `${pointsEarned} loyalty points earned!`
        });
      }
    );
  });
});

// Redeem loyalty points
router.post('/:id/loyalty/redeem', (req, res) => {
  const { id } = req.params;
  const { points, reason } = req.body;
  const companyId = req.user.companyId;

  if (!points || points <= 0) return res.status(400).json({ error: 'Valid points amount required' });

  db.get('SELECT * FROM customers WHERE id = ? AND company_id = ?', [id, companyId], (err, customer) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    if ((customer.loyalty_points || 0) < points) {
      return res.status(400).json({ error: 'Insufficient loyalty points', available: customer.loyalty_points });
    }

    const newTotal = customer.loyalty_points - parseInt(points);
    // Default: 100 points = R10 discount
    const discountValue = parseInt(points) / 10;

    db.run(
      'UPDATE customers SET loyalty_points = ? WHERE id = ? AND company_id = ?',
      [newTotal, id, companyId],
      (err) => {
        if (err) return res.status(500).json({ error: 'Failed to redeem points' });

        db.run(
          `INSERT INTO loyalty_point_transactions (company_id, customer_id, transaction_type, points, balance_after, description)
           VALUES (?, ?, 'redeem', ?, ?, ?)`,
          [companyId, id, -parseInt(points), newTotal, reason || 'Points redeemed for discount']
        );

        logAudit(req, 'LOYALTY_REDEEM', 'customer', id, { metadata: { pointsRedeemed: points, discountValue, newTotal } });

        res.json({
          pointsRedeemed: parseInt(points),
          discountValue,
          remainingPoints: newTotal,
          message: `${points} points redeemed for R${discountValue.toFixed(2)} discount`
        });
      }
    );
  });
});

// Get loyalty balance
router.get('/:id/loyalty', (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  db.get('SELECT id, name, loyalty_points, loyalty_tier FROM customers WHERE id = ? AND company_id = ?', [id, companyId], (err, customer) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    res.json({
      customerId: customer.id,
      name: customer.name,
      points: customer.loyalty_points || 0,
      tier: customer.loyalty_tier || 'bronze',
      redeemableValue: ((customer.loyalty_points || 0) / 10).toFixed(2)
    });
  });
});

// ========== CREDIT ACCOUNTS ==========

// Purchase on account (create credit transaction)
router.post('/:id/account/charge', requirePermission('CUSTOMERS.EDIT'), (req, res) => {
  const { id } = req.params;
  const { amount, saleId, description } = req.body;
  const companyId = req.user.companyId;

  if (!amount || amount <= 0) return res.status(400).json({ error: 'Valid amount required' });

  db.get('SELECT * FROM customers WHERE id = ? AND company_id = ?', [id, companyId], (err, customer) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const currentBalance = parseFloat(customer.current_balance) || 0;
    const creditLimit = parseFloat(customer.credit_limit) || 0;
    const newBalance = currentBalance + parseFloat(amount);

    if (creditLimit > 0 && newBalance > creditLimit) {
      return res.status(400).json({
        error: 'Credit limit would be exceeded',
        currentBalance, creditLimit,
        requestedAmount: parseFloat(amount),
        availableCredit: creditLimit - currentBalance
      });
    }

    db.run(
      'UPDATE customers SET current_balance = ? WHERE id = ? AND company_id = ?',
      [newBalance, id, companyId],
      (err) => {
        if (err) return res.status(500).json({ error: 'Failed to update balance' });

        db.run(
          `INSERT INTO customer_account_transactions (company_id, customer_id, transaction_type, amount, balance_after, reference_id, description, created_by_user_id)
           VALUES (?, ?, 'charge', ?, ?, ?, ?, ?)`,
          [companyId, id, parseFloat(amount), newBalance, saleId ? String(saleId) : null, description || 'Purchase on account', req.user.userId]
        );

        logAudit(req, 'ACCOUNT_CHARGE', 'customer', id, { metadata: { amount, newBalance, saleId } });

        res.json({
          success: true,
          previousBalance: currentBalance,
          chargeAmount: parseFloat(amount),
          newBalance, creditLimit,
          availableCredit: creditLimit > 0 ? creditLimit - newBalance : 'unlimited'
        });
      }
    );
  });
});

// Record payment on account
router.post('/:id/account/payment', requirePermission('CUSTOMERS.EDIT'), (req, res) => {
  const { id } = req.params;
  const { amount, paymentMethod, reference } = req.body;
  const companyId = req.user.companyId;

  if (!amount || amount <= 0) return res.status(400).json({ error: 'Valid amount required' });

  db.get('SELECT * FROM customers WHERE id = ? AND company_id = ?', [id, companyId], (err, customer) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const currentBalance = parseFloat(customer.current_balance) || 0;
    const newBalance = Math.max(0, currentBalance - parseFloat(amount));

    db.run(
      'UPDATE customers SET current_balance = ? WHERE id = ? AND company_id = ?',
      [newBalance, id, companyId],
      (err) => {
        if (err) return res.status(500).json({ error: 'Failed to update balance' });

        db.run(
          `INSERT INTO customer_account_transactions (company_id, customer_id, transaction_type, amount, balance_after, reference_id, description, created_by_user_id)
           VALUES (?, ?, 'payment', ?, ?, ?, ?, ?)`,
          [companyId, id, -parseFloat(amount), newBalance, reference || null,
           `Payment received via ${paymentMethod || 'cash'}`, req.user.userId]
        );

        logAudit(req, 'ACCOUNT_PAYMENT', 'customer', id, { metadata: { amount, paymentMethod, newBalance } });

        res.json({
          success: true,
          previousBalance: currentBalance,
          paymentAmount: parseFloat(amount),
          newBalance,
          message: newBalance === 0 ? 'Account fully paid!' : `Outstanding balance: R${newBalance.toFixed(2)}`
        });
      }
    );
  });
});

// Get account statement
router.get('/:id/account', requirePermission('CUSTOMERS.VIEW'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  db.get('SELECT id, name, current_balance, credit_limit FROM customers WHERE id = ? AND company_id = ?', [id, companyId], (err, customer) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    db.all(
      `SELECT * FROM customer_account_transactions WHERE customer_id = ? AND company_id = ? ORDER BY created_at DESC LIMIT 50`,
      [id, companyId],
      (err, transactions) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({
          customer: {
            id: customer.id, name: customer.name,
            currentBalance: parseFloat(customer.current_balance) || 0,
            creditLimit: parseFloat(customer.credit_limit) || 0,
            availableCredit: (parseFloat(customer.credit_limit) || 0) - (parseFloat(customer.current_balance) || 0)
          },
          transactions: transactions || []
        });
      }
    );
  });
});

// ========== HELPERS ==========

function calculateTier(points) {
  if (points >= 10000) return 'platinum';
  if (points >= 5000) return 'gold';
  if (points >= 1000) return 'silver';
  return 'bronze';
}

module.exports = router;
