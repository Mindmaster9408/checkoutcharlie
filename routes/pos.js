/**
 * POS Routes - Multi-Tenant
 * All routes filter by company_id from the authenticated user's context
 */

const express = require('express');
const db = require('../database');
const { authenticateToken, requireCompany, requirePermission } = require('../middleware/auth');

const router = express.Router();

// Apply authentication and company requirement to all routes
router.use(authenticateToken);
router.use(requireCompany);

// Get all tills for the current company
router.get('/tills', (req, res) => {
  const companyId = req.user.companyId;

  db.all('SELECT * FROM tills WHERE company_id = ? AND is_active = 1', [companyId], (err, tills) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ tills });
  });
});

// Get till sessions for the current company
router.get('/sessions', (req, res) => {
  const companyId = req.user.companyId;
  const { status } = req.query;
  const userRole = req.user.role;
  const userId = req.user.userId;

  let query = `
    SELECT ts.*, t.till_name, u.full_name as user_name
    FROM till_sessions ts
    JOIN tills t ON ts.till_id = t.id
    JOIN users u ON ts.user_id = u.id
    WHERE ts.company_id = ?
  `;

  const params = [companyId];

  // Cashiers can only see their own sessions
  if (userRole === 'cashier') {
    query += ' AND ts.user_id = ?';
    params.push(userId);
  }

  if (status) {
    query += ' AND ts.status = ?';
    params.push(status);
  }

  query += ' ORDER BY ts.opened_at DESC';

  db.all(query, params, (err, sessions) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ sessions });
  });
});

// Open till session
router.post('/sessions/open', (req, res) => {
  const { tillId, openingBalance } = req.body;
  const userId = req.user.userId;
  const companyId = req.user.companyId;

  // Verify till belongs to this company
  db.get('SELECT * FROM tills WHERE id = ? AND company_id = ?', [tillId, companyId], (err, till) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!till) {
      return res.status(404).json({ error: 'Till not found in this company' });
    }

    // Check if there's already an open session for this till
    db.get('SELECT * FROM till_sessions WHERE till_id = ? AND status = ?', [tillId, 'open'], (err, existingSession) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (existingSession) {
        return res.status(400).json({ error: 'This till already has an open session' });
      }

      db.run(
        'INSERT INTO till_sessions (company_id, till_id, user_id, opening_balance) VALUES (?, ?, ?, ?)',
        [companyId, tillId, userId, openingBalance],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Failed to open session' });
          }

          db.get('SELECT * FROM till_sessions WHERE id = ?', [this.lastID], (err, session) => {
            if (err) {
              return res.status(500).json({ error: 'Database error' });
            }
            res.json({ session });
          });
        }
      );
    });
  });
});

// Close till session
router.post('/sessions/:id/close', (req, res) => {
  const { id } = req.params;
  const { closingBalance, closing_balance, expectedBalance, expected_balance, variance, notes } = req.body;
  const companyId = req.user.companyId;

  // Support both camelCase and snake_case
  const closingBal = closingBalance || closing_balance;
  const expectedBal = expectedBalance || expected_balance;
  const varianceVal = variance;

  // Get session and calculate expected balance
  db.get(`
    SELECT ts.*,
           COALESCE(SUM(s.total_amount), 0) as total_sales
    FROM till_sessions ts
    LEFT JOIN sales s ON s.till_session_id = ts.id
    WHERE ts.id = ? AND ts.company_id = ?
    GROUP BY ts.id
  `, [id, companyId], (err, session) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.status !== 'open') {
      return res.status(400).json({ error: 'Session is already closed' });
    }

    const calculatedExpected = parseFloat(session.opening_balance) + parseFloat(session.total_sales);
    const finalExpected = expectedBal || calculatedExpected;
    const finalVariance = varianceVal !== undefined ? varianceVal : (parseFloat(closingBal) - finalExpected);

    db.run(
      `UPDATE till_sessions
       SET closing_balance = ?, expected_balance = ?, variance = ?,
           status = 'closed', closed_at = CURRENT_TIMESTAMP, notes = ?
       WHERE id = ? AND company_id = ?`,
      [closingBal, finalExpected, finalVariance, notes, id, companyId],
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to close session' });
        }

        res.json({
          success: true,
          closingBalance: closingBal,
          expectedBalance: finalExpected,
          variance: finalVariance,
          totalSales: session.total_sales
        });
      }
    );
  });
});

// Get products for the current company
router.get('/products', (req, res) => {
  const companyId = req.user.companyId;

  db.all('SELECT * FROM products WHERE company_id = ? AND is_active = 1 ORDER BY product_name', [companyId], (err, products) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ products });
  });
});

// Generate next product code based on company prefix
router.get('/products/next-code/:prefix', (req, res) => {
  const prefix = req.params.prefix.toUpperCase().substring(0, 3);
  const companyId = req.user.companyId;

  // Find the highest existing code with this prefix for this company
  db.all(
    `SELECT product_code FROM products WHERE company_id = ? AND product_code LIKE ? ORDER BY product_code DESC LIMIT 1`,
    [companyId, `${prefix}%`],
    (err, results) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      let nextNumber = 1;

      if (results && results.length > 0) {
        const lastCode = results[0].product_code;
        const numberPart = lastCode.replace(prefix, '');
        const lastNumber = parseInt(numberPart, 10);
        if (!isNaN(lastNumber)) {
          nextNumber = lastNumber + 1;
        }
      }

      const nextCode = `${prefix}${String(nextNumber).padStart(3, '0')}`;
      res.json({ code: nextCode });
    }
  );
});

// Create product
router.post('/products', requirePermission('PRODUCTS.CREATE'), (req, res) => {
  const companyId = req.user.companyId;
  const {
    product_code,
    product_name,
    category,
    unit_price,
    cost_price,
    is_active,
    barcode,
    requires_vat,
    vat_rate
  } = req.body;

  if (!product_code || !product_name || unit_price === undefined) {
    return res.status(400).json({ error: 'Product code, name, and price are required' });
  }

  db.run(
    `INSERT INTO products (company_id, product_code, product_name, category, unit_price, cost_price, is_active, barcode, requires_vat, vat_rate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      companyId,
      product_code,
      product_name,
      category || null,
      parseFloat(unit_price),
      parseFloat(cost_price) || 0,
      is_active ? 1 : 0,
      barcode || null,
      requires_vat ? 1 : 0,
      parseFloat(vat_rate) || 15
    ],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to create product: ' + err.message });
      }

      db.get('SELECT * FROM products WHERE id = ?', [this.lastID], (err, product) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        res.json({ product, message: 'Product created successfully' });
      });
    }
  );
});

// Update product
router.put('/products/:id', requirePermission('PRODUCTS.EDIT'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const {
    product_code,
    product_name,
    category,
    unit_price,
    cost_price,
    is_active,
    barcode,
    requires_vat,
    vat_rate
  } = req.body;

  if (!product_code || !product_name || unit_price === undefined) {
    return res.status(400).json({ error: 'Product code, name, and price are required' });
  }

  db.run(
    `UPDATE products
     SET product_code = ?, product_name = ?, category = ?, unit_price = ?, cost_price = ?,
         is_active = ?, barcode = ?, requires_vat = ?, vat_rate = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND company_id = ?`,
    [
      product_code,
      product_name,
      category || null,
      parseFloat(unit_price),
      parseFloat(cost_price) || 0,
      is_active ? 1 : 0,
      barcode || null,
      requires_vat ? 1 : 0,
      parseFloat(vat_rate) || 15,
      id,
      companyId
    ],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to update product' });
      }

      db.get('SELECT * FROM products WHERE id = ? AND company_id = ?', [id, companyId], (err, product) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        res.json({ product, message: 'Product updated successfully' });
      });
    }
  );
});

// Delete product (soft delete)
router.delete('/products/:id', requirePermission('PRODUCTS.DELETE'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  db.run(
    'UPDATE products SET is_active = 0 WHERE id = ? AND company_id = ?',
    [id, companyId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to delete product' });
      }
      res.json({ message: 'Product deleted successfully' });
    }
  );
});

// Create sale
router.post('/sales', (req, res) => {
  const { tillSessionId, items, paymentMethod, customerId } = req.body;
  const userId = req.user.userId;
  const companyId = req.user.companyId;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'No items in sale' });
  }

  // Verify till session is open and belongs to this company
  db.get('SELECT * FROM till_sessions WHERE id = ? AND company_id = ? AND status = ?', [tillSessionId, companyId, 'open'], (err, session) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!session) {
      return res.status(400).json({ error: 'Till session not found or not open' });
    }

    // Get product details and verify stock
    const productIds = items.map(item => item.productId);
    const placeholders = productIds.map((_, i) => `$${i + 2}`).join(',');

    db.all(`SELECT * FROM products WHERE company_id = $1 AND id IN (${placeholders})`, [companyId, ...productIds], (err, products) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      // Validate stock and calculate totals
      let subtotal = 0;
      const saleItems = [];

      for (const item of items) {
        const product = products.find(p => p.id === item.productId);

        if (!product) {
          return res.status(400).json({ error: `Product ${item.productId} not found` });
        }

        if (product.stock_quantity < item.quantity) {
          return res.status(400).json({ error: `Insufficient stock for ${product.product_name}` });
        }

        const itemTotal = product.unit_price * item.quantity;
        subtotal += itemTotal;

        saleItems.push({
          productId: product.id,
          quantity: item.quantity,
          unitPrice: product.unit_price,
          totalPrice: itemTotal
        });
      }

      const vatAmount = subtotal * 0.15;
      const totalAmount = subtotal + vatAmount;

      // Generate sale number
      const saleNumber = `SALE-${Date.now()}`;

      // Insert sale
      db.run(
        `INSERT INTO sales (company_id, sale_number, till_session_id, user_id, customer_id, subtotal, vat_amount, total_amount, payment_method)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [companyId, saleNumber, tillSessionId, userId, customerId || null, subtotal, vatAmount, totalAmount, paymentMethod],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Failed to create sale' });
          }

          const saleId = this.lastID;

          // Insert sale items and update stock
          const stmt = db.prepare('INSERT INTO sale_items (company_id, sale_id, product_id, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?, ?)');
          const updateStmt = db.prepare('UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND company_id = ?');

          saleItems.forEach(item => {
            stmt.run(companyId, saleId, item.productId, item.quantity, item.unitPrice, item.totalPrice);
            updateStmt.run(item.quantity, item.productId, companyId);
          });

          stmt.finalize();
          updateStmt.finalize();

          res.json({
            saleId,
            saleNumber,
            subtotal,
            vatAmount,
            totalAmount,
            paymentMethod
          });
        }
      );
    });
  });
});

// Get sales for a session
router.get('/sessions/:id/sales', (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  db.all(`
    SELECT s.*, u.full_name as cashier_name
    FROM sales s
    JOIN users u ON s.user_id = u.id
    WHERE s.till_session_id = ? AND s.company_id = ?
    ORDER BY s.created_at DESC
  `, [id, companyId], (err, sales) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ sales });
  });
});

module.exports = router;
