/**
 * POS Routes - Multi-Tenant
 * All routes filter by company_id from the authenticated user's context
 */

const express = require('express');
const db = require('../database');
const { authenticateToken, requireCompany, requirePermission } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

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
// Cashiers can only close their own sessions
// Admins can close on behalf of cashiers (for cash-up management)
router.post('/sessions/:id/close', (req, res) => {
  const { id } = req.params;
  const { closingBalance, closing_balance, expectedBalance, expected_balance, variance, notes } = req.body;
  const companyId = req.user.companyId;
  const userRole = req.user.role;
  const userId = req.user.userId;

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

    // Cashiers can only close their own sessions
    if (userRole === 'cashier' && session.user_id !== userId) {
      return res.status(403).json({ error: 'You can only close your own sessions' });
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

// ========== PRODUCT STOCK BY LOCATION ==========

// Get product stock across all locations
router.get('/products/:id/stock-by-location', (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  // First get the parent company (if current is a location)
  db.get('SELECT * FROM companies WHERE id = ?', [companyId], (err, company) => {
    if (err) return res.status(500).json({ error: 'Database error' });

    const parentId = company.parent_company_id || companyId;

    // Get all locations under this parent
    db.all(`
      SELECT c.id as location_id, c.location_name, c.company_name,
        pc.stock_quantity, pc.reorder_level, pc.is_active, pc.price_override
      FROM companies c
      LEFT JOIN product_companies pc ON c.id = pc.company_id AND pc.product_id = ?
      WHERE (c.id = ? OR c.parent_company_id = ?)
        AND c.is_active = 1
      ORDER BY c.is_location, c.location_name, c.company_name
    `, [id, parentId, parentId], (err, locations) => {
      if (err) return res.status(500).json({ error: 'Database error' });

      // Format location names
      const formattedLocations = (locations || []).map(loc => ({
        ...loc,
        location_name: loc.location_name || loc.company_name || 'Main',
        stock_quantity: loc.stock_quantity || 0,
        reorder_level: loc.reorder_level || 10,
        is_active: loc.is_active !== 0
      }));

      res.json({ locations: formattedLocations });
    });
  });
});

// Update product stock across locations
router.put('/products/:id/stock-by-location', requirePermission('PRODUCTS.EDIT'), (req, res) => {
  const { id } = req.params;
  const { stockData } = req.body;

  if (!stockData || !Array.isArray(stockData)) {
    return res.status(400).json({ error: 'Stock data is required' });
  }

  // Process each location's stock
  const queries = stockData.map(item => {
    return new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO product_companies (product_id, company_id, stock_quantity, reorder_level, is_active)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(product_id, company_id) DO UPDATE SET
          stock_quantity = ?,
          reorder_level = ?,
          is_active = ?
      `, [
        id, item.location_id, item.stock_quantity, item.reorder_level, item.is_active,
        item.stock_quantity, item.reorder_level, item.is_active
      ], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  Promise.all(queries)
    .then(() => {
      res.json({ message: 'Stock levels updated successfully' });
    })
    .catch(err => {
      console.error('Error saving stock:', err);
      res.status(500).json({ error: 'Failed to save stock levels' });
    });
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
        `INSERT INTO sales (company_id, sale_number, till_session_id, user_id, customer_id, subtotal, vat_amount, total_amount, payment_method, payment_status, payment_complete)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', 1)`,
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

          // Record payment in sale_payments table
          db.run(
            `INSERT INTO sale_payments (company_id, sale_id, payment_method, amount, reference_number, status)
             VALUES (?, ?, ?, ?, ?, 'completed')`,
            [companyId, saleId, paymentMethod, totalAmount, saleNumber]
          );

          // Forensic audit log
          logAudit(req, 'CREATE', 'sale', saleId, {
            metadata: { saleNumber, subtotal, vatAmount, totalAmount, paymentMethod, itemCount: saleItems.length }
          });

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
  const userRole = req.user.role;
  const userId = req.user.userId;

  // First verify access to session (cashiers can only see their own)
  db.get('SELECT user_id FROM till_sessions WHERE id = ? AND company_id = ?', [id, companyId], (err, session) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (userRole === 'cashier' && session.user_id !== userId) {
      return res.status(403).json({ error: 'You can only view your own sessions' });
    }

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
});

// Get current open session for the logged-in user
router.get('/sessions/current', (req, res) => {
  const companyId = req.user.companyId;
  const userId = req.user.userId;

  db.get(`
    SELECT ts.*, t.till_name, u.full_name as user_name
    FROM till_sessions ts
    JOIN tills t ON ts.till_id = t.id
    JOIN users u ON ts.user_id = u.id
    WHERE ts.company_id = ? AND ts.user_id = ? AND ts.status = 'open'
    ORDER BY ts.opened_at DESC
    LIMIT 1
  `, [companyId, userId], (err, session) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ session: session || null });
  });
});

// Get all sales (for admins to view and manage cash-ups on behalf of cashiers)
router.get('/sales', (req, res) => {
  const companyId = req.user.companyId;
  const userRole = req.user.role;
  const userId = req.user.userId;
  const { session_id } = req.query;

  let query = `
    SELECT s.*, u.full_name as cashier_name
    FROM sales s
    JOIN users u ON s.user_id = u.id
    WHERE s.company_id = ?
  `;
  const params = [companyId];

  // If session_id provided, filter by it
  if (session_id) {
    query += ' AND s.till_session_id = ?';
    params.push(session_id);

    // If cashier, verify they own this session
    if (userRole === 'cashier') {
      db.get('SELECT user_id FROM till_sessions WHERE id = ? AND company_id = ?', [session_id, companyId], (err, session) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }

        if (!session || session.user_id !== userId) {
          return res.status(403).json({ error: 'You can only view your own sessions' });
        }

        db.all(query + ' ORDER BY s.created_at DESC', params, (err, sales) => {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }
          res.json({ sales });
        });
      });
      return;
    }
  } else {
    // If no session_id, cashiers can only see their own sales
    if (userRole === 'cashier') {
      query += ' AND s.user_id = ?';
      params.push(userId);
    }
  }

  query += ' ORDER BY s.created_at DESC LIMIT 500';

  db.all(query, params, (err, sales) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ sales });
  });
});

// ========== SALE SEARCH & LOOKUP ==========

// Search sales by sale number, date, customer, or amount
router.get('/sales/search', (req, res) => {
  const companyId = req.user.companyId;
  const { query: searchQuery, date_from, date_to, sale_number } = req.query;

  let sql = `
    SELECT s.*, u.full_name as cashier_name, c.name as customer_name,
           ts.till_id, t.till_name
    FROM sales s
    JOIN users u ON s.user_id = u.id
    LEFT JOIN customers c ON s.customer_id = c.id
    JOIN till_sessions ts ON s.till_session_id = ts.id
    JOIN tills t ON ts.till_id = t.id
    WHERE s.company_id = ?
  `;
  const params = [companyId];

  if (sale_number) {
    sql += ' AND s.sale_number LIKE ?';
    params.push(`%${sale_number}%`);
  }

  if (searchQuery) {
    sql += ' AND (s.sale_number LIKE ? OR c.name LIKE ? OR CAST(s.total_amount AS TEXT) LIKE ?)';
    params.push(`%${searchQuery}%`, `%${searchQuery}%`, `%${searchQuery}%`);
  }

  if (date_from) {
    sql += ' AND DATE(s.created_at) >= ?';
    params.push(date_from);
  }

  if (date_to) {
    sql += ' AND DATE(s.created_at) <= ?';
    params.push(date_to);
  }

  sql += ' ORDER BY s.created_at DESC LIMIT 100';

  db.all(sql, params, (err, sales) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ sales });
  });
});

// Get sale details with items
router.get('/sales/:id', (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  db.get(`
    SELECT s.*, u.full_name as cashier_name, c.name as customer_name,
           c.contact_number as customer_phone, c.email as customer_email,
           ts.till_id, t.till_name
    FROM sales s
    JOIN users u ON s.user_id = u.id
    LEFT JOIN customers c ON s.customer_id = c.id
    JOIN till_sessions ts ON s.till_session_id = ts.id
    JOIN tills t ON ts.till_id = t.id
    WHERE s.id = ? AND s.company_id = ?
  `, [id, companyId], (err, sale) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    // Get sale items
    db.all(`
      SELECT si.*, p.product_name, p.product_code, p.barcode
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      WHERE si.sale_id = ?
    `, [id], (err, items) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      res.json({ sale, items });
    });
  });
});

// ========== SALE RETURNS ==========

// Process a return
router.post('/sales/:id/return', requirePermission('POS.VOID_SALE'), (req, res) => {
  const { id } = req.params;
  const { items, reason, authorized_by_user_id } = req.body;
  const companyId = req.user.companyId;
  const userId = req.user.userId;
  const userRole = req.user.role;

  // Get original sale
  db.get('SELECT * FROM sales WHERE id = ? AND company_id = ?', [id, companyId], (err, sale) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    // Get original sale items
    db.all('SELECT * FROM sale_items WHERE sale_id = ?', [id], (err, saleItems) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      // Validate return items
      let totalRefund = 0;
      const returnItems = [];

      for (const returnItem of items) {
        const originalItem = saleItems.find(si => si.product_id === returnItem.product_id);

        if (!originalItem) {
          return res.status(400).json({ error: `Product ${returnItem.product_id} not in original sale` });
        }

        if (returnItem.quantity > originalItem.quantity) {
          return res.status(400).json({ error: `Cannot return more than purchased` });
        }

        const refundAmount = (originalItem.unit_price * returnItem.quantity);
        totalRefund += refundAmount;

        returnItems.push({
          sale_item_id: originalItem.id,
          product_id: returnItem.product_id,
          quantity: returnItem.quantity,
          refund_amount: refundAmount
        });
      }

      // Generate return number
      const returnNumber = `RET-${Date.now()}`;

      // Determine authorizer - cashiers need manager authorization
      let authorizerId = authorized_by_user_id || userId;
      if (userRole === 'cashier' && !authorized_by_user_id) {
        return res.status(403).json({ error: 'Manager authorization required for returns' });
      }

      // Create return record
      db.run(
        `INSERT INTO sale_returns (company_id, original_sale_id, return_number, total_refund, reason, processed_by_user_id, authorized_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [companyId, id, returnNumber, totalRefund, reason, userId, authorizerId],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Failed to create return' });
          }

          const returnId = this.lastID;

          // Insert return items and restore stock
          const stmt = db.prepare('INSERT INTO sale_return_items (return_id, sale_item_id, product_id, quantity_returned, refund_amount) VALUES (?, ?, ?, ?, ?)');
          const stockStmt = db.prepare('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ? AND company_id = ?');

          returnItems.forEach(item => {
            stmt.run(returnId, item.sale_item_id, item.product_id, item.quantity, item.refund_amount);
            stockStmt.run(item.quantity, item.product_id, companyId);
          });

          stmt.finalize();
          stockStmt.finalize();

          // Log audit
          db.run(
            `INSERT INTO audit_trail (company_id, user_id, event_type, event_category, event_data)
             VALUES (?, ?, ?, ?, ?)`,
            [companyId, userId, 'sale_return', 'sales', JSON.stringify({ returnNumber, originalSaleId: id, totalRefund, authorizedBy: authorizerId })]
          );

          // Forensic audit log
          logAudit(req, 'RETURN', 'sale', id, {
            metadata: { returnNumber, returnId, totalRefund, authorizedBy: authorizerId, itemCount: returnItems.length }
          });

          res.json({
            success: true,
            returnId,
            returnNumber,
            totalRefund,
            items: returnItems
          });
        }
      );
    });
  });
});

// ========== SPLIT PAYMENTS ==========

// Create sale with split payment
router.post('/sales/split-payment', (req, res) => {
  const { tillSessionId, items, payments, customerId } = req.body;
  const userId = req.user.userId;
  const companyId = req.user.companyId;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'No items in sale' });
  }

  if (!payments || payments.length === 0) {
    return res.status(400).json({ error: 'No payments provided' });
  }

  // Verify till session
  db.get('SELECT * FROM till_sessions WHERE id = ? AND company_id = ? AND status = ?', [tillSessionId, companyId, 'open'], (err, session) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!session) {
      return res.status(400).json({ error: 'Till session not found or not open' });
    }

    // Get product details
    const productIds = items.map(item => item.productId);
    const placeholders = productIds.map((_, i) => `$${i + 2}`).join(',');

    db.all(`SELECT * FROM products WHERE company_id = $1 AND id IN (${placeholders})`, [companyId, ...productIds], (err, products) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      // Calculate totals
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

        // Check for daily discount
        const effectivePrice = item.overridePrice || product.unit_price;
        const itemTotal = effectivePrice * item.quantity;
        subtotal += itemTotal;

        saleItems.push({
          productId: product.id,
          quantity: item.quantity,
          unitPrice: effectivePrice,
          totalPrice: itemTotal
        });
      }

      const vatAmount = subtotal * 0.15;
      const totalAmount = subtotal + vatAmount;

      // Validate payments total
      const totalPayments = payments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
      if (Math.abs(totalPayments - totalAmount) > 0.01) {
        return res.status(400).json({
          error: 'Payment amounts do not match total',
          expected: totalAmount,
          received: totalPayments
        });
      }

      // Format payment method string
      const paymentMethod = payments.map(p => `${p.method}:${p.amount}`).join(',');

      const saleNumber = `SALE-${Date.now()}`;

      // Insert sale with split payment
      db.run(
        `INSERT INTO sales (company_id, sale_number, till_session_id, user_id, customer_id, subtotal, vat_amount, total_amount, payment_method, payment_status, payment_complete)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', 1)`,
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

          // Record each payment in sale_payments table
          const payStmt = db.prepare(
            `INSERT INTO sale_payments (company_id, sale_id, payment_method, amount, reference_number, status)
             VALUES (?, ?, ?, ?, ?, 'completed')`
          );
          payments.forEach(p => {
            payStmt.run(companyId, saleId, p.method, parseFloat(p.amount), p.reference || null);
          });
          payStmt.finalize();

          // Forensic audit log
          logAudit(req, 'CREATE', 'sale', saleId, {
            metadata: { saleNumber, subtotal, vatAmount, totalAmount, splitPayment: true, payments, itemCount: saleItems.length }
          });

          res.json({
            saleId,
            saleNumber,
            subtotal,
            vatAmount,
            totalAmount,
            payments
          });
        }
      );
    });
  });
});

// ========== STOCK MANAGEMENT ==========

// Get stock levels
router.get('/stock', (req, res) => {
  const companyId = req.user.companyId;
  const { low_stock_only, category } = req.query;

  let query = `
    SELECT id, product_code, product_name, category, stock_quantity, min_stock_level, unit_price, cost_price
    FROM products
    WHERE company_id = ? AND is_active = 1
  `;
  const params = [companyId];

  if (low_stock_only === 'true') {
    query += ' AND stock_quantity <= min_stock_level';
  }

  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }

  query += ' ORDER BY product_name';

  db.all(query, params, (err, products) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ products });
  });
});

// Adjust stock
router.post('/stock/adjust', requirePermission('STOCK.ADJUST'), (req, res) => {
  const { product_id, adjustment_type, quantity, reason, reference_number } = req.body;
  const companyId = req.user.companyId;
  const userId = req.user.userId;

  if (!product_id || !adjustment_type || quantity === undefined) {
    return res.status(400).json({ error: 'Product ID, adjustment type, and quantity required' });
  }

  // Get current stock
  db.get('SELECT * FROM products WHERE id = ? AND company_id = ?', [product_id, companyId], (err, product) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const quantityBefore = product.stock_quantity;
    let quantityChange = parseInt(quantity);

    // Adjust based on type
    if (adjustment_type === 'remove' || adjustment_type === 'damage' || adjustment_type === 'theft') {
      quantityChange = -Math.abs(quantityChange);
    } else if (adjustment_type === 'add' || adjustment_type === 'restock' || adjustment_type === 'return') {
      quantityChange = Math.abs(quantityChange);
    } else if (adjustment_type === 'set') {
      quantityChange = parseInt(quantity) - quantityBefore;
    }

    const quantityAfter = quantityBefore + quantityChange;

    if (quantityAfter < 0) {
      return res.status(400).json({ error: 'Cannot reduce stock below zero' });
    }

    // Update stock
    db.run('UPDATE products SET stock_quantity = ? WHERE id = ? AND company_id = ?', [quantityAfter, product_id, companyId], (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to adjust stock' });
      }

      // Log adjustment
      db.run(
        `INSERT INTO stock_adjustments (company_id, product_id, adjustment_type, quantity_change, quantity_before, quantity_after, reason, reference_number, adjusted_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [companyId, product_id, adjustment_type, quantityChange, quantityBefore, quantityAfter, reason, reference_number, userId]
      );

      // Log audit
      db.run(
        `INSERT INTO audit_trail (company_id, user_id, event_type, event_category, event_data)
         VALUES (?, ?, ?, ?, ?)`,
        [companyId, userId, 'stock_adjustment', 'inventory', JSON.stringify({ product_id, adjustment_type, quantityChange, quantityBefore, quantityAfter })]
      );

      // Forensic audit log
      logAudit(req, 'STOCK_ADJUST', 'product', product_id, {
        metadata: { adjustment_type, quantityChange, quantityBefore, quantityAfter, reason }
      });

      res.json({
        success: true,
        product_id,
        quantity_before: quantityBefore,
        quantity_after: quantityAfter,
        change: quantityChange
      });
    });
  });
});

// Bulk stock update (for stock take)
router.post('/stock/bulk-update', requirePermission('STOCK.STOCK_TAKE'), (req, res) => {
  const { items, reference_number } = req.body;
  const companyId = req.user.companyId;
  const userId = req.user.userId;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'No items provided' });
  }

  const results = [];
  let processed = 0;

  items.forEach(item => {
    db.get('SELECT * FROM products WHERE id = ? AND company_id = ?', [item.product_id, companyId], (err, product) => {
      if (err || !product) {
        results.push({ product_id: item.product_id, error: 'Product not found' });
        processed++;
        if (processed === items.length) {
          return res.json({ results });
        }
        return;
      }

      const quantityBefore = product.stock_quantity;
      const quantityAfter = parseInt(item.quantity);
      const quantityChange = quantityAfter - quantityBefore;

      db.run('UPDATE products SET stock_quantity = ? WHERE id = ? AND company_id = ?', [quantityAfter, item.product_id, companyId], (err) => {
        if (err) {
          results.push({ product_id: item.product_id, error: 'Failed to update' });
        } else {
          // Log adjustment
          db.run(
            `INSERT INTO stock_adjustments (company_id, product_id, adjustment_type, quantity_change, quantity_before, quantity_after, reason, reference_number, adjusted_by_user_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [companyId, item.product_id, 'stock_take', quantityChange, quantityBefore, quantityAfter, 'Stock take', reference_number, userId]
          );

          results.push({
            product_id: item.product_id,
            product_name: product.product_name,
            quantity_before: quantityBefore,
            quantity_after: quantityAfter,
            variance: quantityChange
          });
        }

        processed++;
        if (processed === items.length) {
          // Log audit
          db.run(
            `INSERT INTO audit_trail (company_id, user_id, event_type, event_category, event_data)
             VALUES (?, ?, ?, ?, ?)`,
            [companyId, userId, 'stock_take', 'inventory', JSON.stringify({ reference_number, items_count: items.length })]
          );

          res.json({ success: true, results });
        }
      });
    });
  });
});

// Get stock adjustment history
router.get('/stock/history', (req, res) => {
  const companyId = req.user.companyId;
  const { product_id, limit = 50 } = req.query;

  let query = `
    SELECT sa.*, p.product_name, p.product_code, u.full_name as adjusted_by
    FROM stock_adjustments sa
    JOIN products p ON sa.product_id = p.id
    LEFT JOIN users u ON sa.adjusted_by_user_id = u.id
    WHERE sa.company_id = ?
  `;
  const params = [companyId];

  if (product_id) {
    query += ' AND sa.product_id = ?';
    params.push(product_id);
  }

  query += ' ORDER BY sa.created_at DESC LIMIT ?';
  params.push(parseInt(limit));

  db.all(query, params, (err, history) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ history });
  });
});

// ========== DAILY DISCOUNTS ==========

// Get active daily discounts
router.get('/daily-discounts', (req, res) => {
  const companyId = req.user.companyId;

  db.all(`
    SELECT dd.*, p.product_name, p.product_code, p.unit_price as current_price,
           u.full_name as created_by, au.full_name as approved_by
    FROM product_daily_discounts dd
    JOIN products p ON dd.product_id = p.id
    LEFT JOIN users u ON dd.created_by_user_id = u.id
    LEFT JOIN users au ON dd.approved_by_user_id = au.id
    WHERE dd.company_id = ? AND dd.is_active = 1
      AND CURRENT_DATE BETWEEN dd.start_date AND dd.end_date
    ORDER BY dd.created_at DESC
  `, [companyId], (err, discounts) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ discounts });
  });
});

// Create daily discount
router.post('/daily-discounts', requirePermission('POS.APPLY_DISCOUNT'), (req, res) => {
  const { product_id, discount_price, reason, end_date } = req.body;
  const companyId = req.user.companyId;
  const userId = req.user.userId;

  if (!product_id || discount_price === undefined) {
    return res.status(400).json({ error: 'Product ID and discount price required' });
  }

  // Get product's current price
  db.get('SELECT * FROM products WHERE id = ? AND company_id = ?', [product_id, companyId], (err, product) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const today = new Date().toISOString().split('T')[0];
    const endDateValue = end_date || today;

    db.run(
      `INSERT INTO product_daily_discounts (company_id, product_id, discount_price, original_price, reason, start_date, end_date, created_by_user_id, approved_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, product_id, discount_price, product.unit_price, reason, today, endDateValue, userId, userId],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to create discount' });
        }

        // Log audit
        db.run(
          `INSERT INTO audit_trail (company_id, user_id, event_type, event_category, event_data)
           VALUES (?, ?, ?, ?, ?)`,
          [companyId, userId, 'daily_discount_created', 'products', JSON.stringify({ product_id, discount_price, original_price: product.unit_price })]
        );

        res.json({
          success: true,
          discount_id: this.lastID,
          product_name: product.product_name,
          original_price: product.unit_price,
          discount_price
        });
      }
    );
  });
});

// Deactivate daily discount
router.delete('/daily-discounts/:id', requirePermission('POS.APPLY_DISCOUNT'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  db.run('UPDATE product_daily_discounts SET is_active = 0 WHERE id = ? AND company_id = ?', [id, companyId], (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to remove discount' });
    }
    res.json({ success: true });
  });
});

// ========== PRICE OVERRIDES ==========

// Request price override (for manager authorization)
router.post('/price-override', (req, res) => {
  const { product_id, original_price, override_price, reason, authorized_by_user_id } = req.body;
  const companyId = req.user.companyId;
  const userId = req.user.userId;
  const userRole = req.user.role;

  if (!product_id || override_price === undefined || !authorized_by_user_id) {
    return res.status(400).json({ error: 'Product ID, override price, and authorizer required' });
  }

  // Cashiers must have manager authorization
  if (userRole === 'cashier') {
    // Verify authorizer is a manager/admin/owner
    db.get(`
      SELECT uca.role FROM user_company_access uca
      WHERE uca.user_id = ? AND uca.company_id = ?
    `, [authorized_by_user_id, companyId], (err, authorizer) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!authorizer || !['admin', 'business_owner', 'accountant'].includes(authorizer.role)) {
        return res.status(403).json({ error: 'Invalid authorizer - must be manager or owner' });
      }

      // Create override record
      createOverride();
    });
  } else {
    createOverride();
  }

  function createOverride() {
    db.run(
      `INSERT INTO price_overrides (company_id, product_id, original_price, override_price, reason, authorized_by_user_id, cashier_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [companyId, product_id, original_price, override_price, reason, authorized_by_user_id, userId],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to create override' });
        }

        // Log audit
        db.run(
          `INSERT INTO audit_trail (company_id, user_id, event_type, event_category, event_data)
           VALUES (?, ?, ?, ?, ?)`,
          [companyId, userId, 'price_override', 'sales', JSON.stringify({ product_id, original_price, override_price, authorized_by: authorized_by_user_id })]
        );

        res.json({
          success: true,
          override_id: this.lastID
        });
      }
    );
  }
});

// ========== DAILY TILL RESET ==========

// Reset till for new day - marks session as pending_cashup so actual cashup can be done later
router.post('/till/daily-reset', requirePermission('TILL.CLOSE_SESSION'), (req, res) => {
  const { till_id, notes } = req.body;
  const companyId = req.user.companyId;
  const userId = req.user.userId;
  const userRole = req.user.role;

  // Only admins and above can do daily reset
  if (!['admin', 'business_owner', 'accountant'].includes(userRole)) {
    return res.status(403).json({ error: 'Only managers can perform daily till reset' });
  }

  // Get company settings for float amount
  db.get('SELECT till_float_amount FROM company_settings WHERE company_id = ?', [companyId], (err, settings) => {
    const floatAmount = settings?.till_float_amount || 0;

    // Check for open session on this till
    db.get('SELECT * FROM till_sessions WHERE till_id = ? AND company_id = ? AND status = ?', [till_id, companyId, 'open'], (err, session) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      const today = new Date().toISOString().split('T')[0];

      if (session) {
        // Calculate expected balance for current session (for reference)
        db.get('SELECT COALESCE(SUM(total_amount), 0) as total_sales FROM sales WHERE till_session_id = ?', [session.id], (err, salesResult) => {
          const totalSales = salesResult?.total_sales || 0;
          const expectedBalance = parseFloat(session.opening_balance) + parseFloat(totalSales);

          // Mark session as "pending_cashup" - NOT fully closed
          // This allows a new session to be opened while keeping this one for actual cashup later
          db.run(
            `UPDATE till_sessions
             SET expected_balance = ?, status = 'pending_cashup',
                 notes = COALESCE(notes, '') || ' | Daily reset by manager - cashup pending'
             WHERE id = ?`,
            [expectedBalance, session.id],
            (err) => {
              if (err) {
                return res.status(500).json({ error: 'Failed to reset session' });
              }

              // Log the reset
              db.run(
                `INSERT INTO daily_till_resets (company_id, till_id, reset_date, session_id_before, reset_by_user_id, opening_float, notes)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [companyId, till_id, today, session.id, userId, floatAmount, notes]
              );

              // Log audit
              db.run(
                `INSERT INTO audit_trail (company_id, user_id, event_type, event_category, event_data)
                 VALUES (?, ?, ?, ?, ?)`,
                [companyId, userId, 'daily_till_reset', 'till', JSON.stringify({ till_id, previous_session_id: session.id, total_sales: totalSales, status: 'pending_cashup' })]
              );

              res.json({
                success: true,
                message: 'Till reset for new day. Previous session marked for cashup.',
                previous_session: {
                  id: session.id,
                  total_sales: totalSales,
                  expected_balance: expectedBalance,
                  status: 'pending_cashup'
                },
                float_amount: floatAmount,
                note: 'Remember to complete the cashup for the previous session'
              });
            }
          );
        });
      } else {
        // No open session, just log the reset
        db.run(
          `INSERT INTO daily_till_resets (company_id, till_id, reset_date, reset_by_user_id, opening_float, notes)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [companyId, till_id, today, userId, floatAmount, notes]
        );

        res.json({
          success: true,
          message: 'Till reset logged (no open session)',
          float_amount: floatAmount
        });
      }
    });
  });
});

// Get sessions pending cashup
router.get('/sessions/pending-cashup', (req, res) => {
  const companyId = req.user.companyId;
  const userRole = req.user.role;
  const userId = req.user.userId;

  let query = `
    SELECT ts.*, t.till_name, u.full_name as user_name,
           (SELECT COALESCE(SUM(total_amount), 0) FROM sales WHERE till_session_id = ts.id) as total_sales,
           (SELECT COUNT(*) FROM sales WHERE till_session_id = ts.id) as sale_count
    FROM till_sessions ts
    JOIN tills t ON ts.till_id = t.id
    JOIN users u ON ts.user_id = u.id
    WHERE ts.company_id = ? AND ts.status = 'pending_cashup'
  `;
  const params = [companyId];

  // Cashiers can only see their own pending sessions
  if (userRole === 'cashier') {
    query += ' AND ts.user_id = ?';
    params.push(userId);
  }

  query += ' ORDER BY ts.opened_at DESC';

  db.all(query, params, (err, sessions) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ sessions });
  });
});

// Complete cashup for a pending session
router.post('/sessions/:id/complete-cashup', (req, res) => {
  const { id } = req.params;
  const { closing_balance, notes } = req.body;
  const companyId = req.user.companyId;
  const userId = req.user.userId;
  const userRole = req.user.role;

  // Get the session
  db.get('SELECT * FROM till_sessions WHERE id = ? AND company_id = ?', [id, companyId], (err, session) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.status !== 'pending_cashup') {
      return res.status(400).json({ error: 'Session is not pending cashup' });
    }

    // Cashiers can only complete their own sessions
    if (userRole === 'cashier' && session.user_id !== userId) {
      return res.status(403).json({ error: 'You can only complete cashup for your own sessions' });
    }

    // Calculate variance
    const expectedBalance = parseFloat(session.expected_balance) || 0;
    const closingBal = parseFloat(closing_balance) || 0;
    const variance = closingBal - expectedBalance;

    // Complete the cashup
    db.run(
      `UPDATE till_sessions
       SET closing_balance = ?, variance = ?, status = 'closed', closed_at = CURRENT_TIMESTAMP,
           notes = COALESCE(notes, '') || ?
       WHERE id = ?`,
      [closingBal, variance, notes ? ` | Cashup: ${notes}` : ' | Cashup completed', id],
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to complete cashup' });
        }

        // Log audit
        db.run(
          `INSERT INTO audit_trail (company_id, user_id, event_type, event_category, event_data)
           VALUES (?, ?, ?, ?, ?)`,
          [companyId, userId, 'cashup_completed', 'till', JSON.stringify({ session_id: id, closing_balance: closingBal, expected_balance: expectedBalance, variance })]
        );

        res.json({
          success: true,
          session_id: id,
          closing_balance: closingBal,
          expected_balance: expectedBalance,
          variance: variance
        });
      }
    );
  });
});

// ========== COMPANY SETTINGS ==========

// Get company settings
router.get('/settings', (req, res) => {
  const companyId = req.user.companyId;

  db.get('SELECT * FROM company_settings WHERE company_id = ?', [companyId], (err, settings) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    res.json({
      settings: {
        default_float_amount: settings?.till_float_amount || 500,
        receipt_printer_name: settings?.receipt_printer_name || '',
        receipt_printer_ip: settings?.receipt_printer_ip || '',
        receipt_printer_port: settings?.receipt_printer_port || 9100,
        auto_print_receipt: settings?.auto_print_receipt ?? 1,
        receipt_header: settings?.receipt_header || '',
        receipt_footer: settings?.receipt_footer || '',
        product_code_prefix: settings?.product_code_prefix || 'PRO',
        receipt_prefix: settings?.receipt_prefix || 'INV',
        next_receipt_number: settings?.next_receipt_number || 1,
        vat_rate: settings?.vat_rate || 15,
        open_drawer_on_sale: settings?.open_drawer_on_sale ?? 1,
        group_same_items: settings?.group_same_items ?? 1,
        use_product_images: settings?.use_product_images || 0
      }
    });
  });
});

// Update company settings
router.put('/settings', requirePermission('SETTINGS.COMPANY'), (req, res) => {
  const companyId = req.user.companyId;
  const userId = req.user.userId;
  const {
    default_float_amount,
    receipt_printer_name,
    receipt_printer_ip,
    receipt_printer_port,
    auto_print_receipt,
    receipt_header,
    receipt_footer,
    product_code_prefix,
    receipt_prefix,
    next_receipt_number,
    vat_rate,
    open_drawer_on_sale,
    group_same_items,
    use_product_images
  } = req.body;

  // Upsert settings
  db.get('SELECT id FROM company_settings WHERE company_id = ?', [companyId], (err, existing) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (existing) {
      db.run(
        `UPDATE company_settings SET
          till_float_amount = COALESCE(?, till_float_amount),
          receipt_printer_name = COALESCE(?, receipt_printer_name),
          receipt_printer_ip = COALESCE(?, receipt_printer_ip),
          receipt_printer_port = COALESCE(?, receipt_printer_port),
          auto_print_receipt = COALESCE(?, auto_print_receipt),
          receipt_header = COALESCE(?, receipt_header),
          receipt_footer = COALESCE(?, receipt_footer),
          product_code_prefix = COALESCE(?, product_code_prefix),
          receipt_prefix = COALESCE(?, receipt_prefix),
          next_receipt_number = COALESCE(?, next_receipt_number),
          vat_rate = COALESCE(?, vat_rate),
          open_drawer_on_sale = COALESCE(?, open_drawer_on_sale),
          group_same_items = COALESCE(?, group_same_items),
          use_product_images = COALESCE(?, use_product_images),
          updated_at = CURRENT_TIMESTAMP,
          updated_by_user_id = ?
         WHERE company_id = ?`,
        [
          default_float_amount,
          receipt_printer_name,
          receipt_printer_ip,
          receipt_printer_port,
          auto_print_receipt,
          receipt_header,
          receipt_footer,
          product_code_prefix,
          receipt_prefix,
          next_receipt_number,
          vat_rate,
          open_drawer_on_sale,
          group_same_items,
          use_product_images,
          userId,
          companyId
        ],
        (err) => {
          if (err) {
            return res.status(500).json({ error: 'Failed to update settings', details: err.message });
          }
          res.json({ success: true, message: 'Settings updated' });
        }
      );
    } else {
      db.run(
        `INSERT INTO company_settings (
          company_id, till_float_amount, receipt_printer_name, receipt_printer_ip,
          receipt_printer_port, auto_print_receipt, receipt_header, receipt_footer,
          product_code_prefix, receipt_prefix, next_receipt_number, vat_rate,
          open_drawer_on_sale, group_same_items, use_product_images, updated_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          companyId,
          default_float_amount || 500,
          receipt_printer_name || null,
          receipt_printer_ip || null,
          receipt_printer_port || 9100,
          auto_print_receipt ?? 1,
          receipt_header || null,
          receipt_footer || null,
          product_code_prefix || 'PRO',
          receipt_prefix || 'INV',
          next_receipt_number || 1,
          vat_rate || 15,
          open_drawer_on_sale ?? 1,
          group_same_items ?? 1,
          use_product_images || 0,
          userId
        ],
        (err) => {
          if (err) {
            return res.status(500).json({ error: 'Failed to create settings', details: err.message });
          }
          res.json({ success: true, message: 'Settings created' });
        }
      );
    }
  });
});

// ========== RECEIPT PRINTERS ==========

// Get printers
router.get('/printers', (req, res) => {
  const companyId = req.user.companyId;

  db.all('SELECT * FROM receipt_printers WHERE company_id = ? AND is_active = 1 ORDER BY is_default DESC, printer_name', [companyId], (err, printers) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ printers });
  });
});

// Add printer
router.post('/printers', requirePermission('SETTINGS.COMPANY'), (req, res) => {
  const { printer_name, printer_type, ip_address, port, is_default, paper_width } = req.body;
  const companyId = req.user.companyId;

  if (!printer_name) {
    return res.status(400).json({ error: 'Printer name required' });
  }

  // If this is default, unset other defaults
  if (is_default) {
    db.run('UPDATE receipt_printers SET is_default = 0 WHERE company_id = ?', [companyId]);
  }

  db.run(
    `INSERT INTO receipt_printers (company_id, printer_name, printer_type, ip_address, port, is_default, paper_width)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [companyId, printer_name, printer_type || 'network', ip_address, port || 9100, is_default ? 1 : 0, paper_width || 80],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to add printer' });
      }
      res.json({ success: true, printer_id: this.lastID });
    }
  );
});

// Update printer
router.put('/printers/:id', requirePermission('SETTINGS.COMPANY'), (req, res) => {
  const { id } = req.params;
  const { printer_name, printer_type, ip_address, port, is_default, paper_width } = req.body;
  const companyId = req.user.companyId;

  if (is_default) {
    db.run('UPDATE receipt_printers SET is_default = 0 WHERE company_id = ?', [companyId]);
  }

  db.run(
    `UPDATE receipt_printers
     SET printer_name = ?, printer_type = ?, ip_address = ?, port = ?, is_default = ?, paper_width = ?
     WHERE id = ? AND company_id = ?`,
    [printer_name, printer_type, ip_address, port, is_default ? 1 : 0, paper_width, id, companyId],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to update printer' });
      }
      res.json({ success: true });
    }
  );
});

// Delete printer
router.delete('/printers/:id', requirePermission('SETTINGS.COMPANY'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  db.run('UPDATE receipt_printers SET is_active = 0 WHERE id = ? AND company_id = ?', [id, companyId], (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to delete printer' });
    }
    res.json({ success: true });
  });
});

// ========== PRODUCTS WITH DAILY DISCOUNTS ==========

// Get products with current discounts applied
router.get('/products/with-discounts', (req, res) => {
  const companyId = req.user.companyId;

  db.all(`
    SELECT p.*,
           dd.discount_price,
           dd.reason as discount_reason,
           CASE WHEN dd.id IS NOT NULL THEN 1 ELSE 0 END as has_discount
    FROM products p
    LEFT JOIN product_daily_discounts dd ON p.id = dd.product_id
      AND dd.company_id = p.company_id
      AND dd.is_active = 1
      AND CURRENT_DATE BETWEEN dd.start_date AND dd.end_date
    WHERE p.company_id = ? AND p.is_active = 1
    ORDER BY p.product_name
  `, [companyId], (err, products) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Set effective price
    products.forEach(p => {
      p.effective_price = p.has_discount ? p.discount_price : p.unit_price;
    });

    res.json({ products });
  });
});

// ========== VOID SALE ==========

// Void a sale (manager+ only, requires reason)
router.post('/sales/:id/void', requirePermission('POS.VOID_SALE'), (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const companyId = req.user.companyId;
  const userId = req.user.userId;

  if (!reason || reason.trim().length < 3) {
    return res.status(400).json({ error: 'A valid reason is required for voiding a sale' });
  }

  db.get('SELECT * FROM sales WHERE id = ? AND company_id = ?', [id, companyId], (err, sale) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!sale) return res.status(404).json({ error: 'Sale not found' });

    if (sale.voided_at) {
      return res.status(400).json({ error: 'Sale has already been voided' });
    }

    // Void the sale
    db.run(
      `UPDATE sales SET voided_at = CURRENT_TIMESTAMP, voided_by = ?, void_reason = ?, payment_status = 'voided' WHERE id = ? AND company_id = ?`,
      [userId, reason, id, companyId],
      (err) => {
        if (err) return res.status(500).json({ error: 'Failed to void sale' });

        // Restore stock for all items
        db.all('SELECT * FROM sale_items WHERE sale_id = ?', [id], (err, items) => {
          if (!err && items) {
            items.forEach(item => {
              db.run('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ? AND company_id = ?',
                [item.quantity, item.product_id, companyId]);
            });
          }
        });

        // Forensic audit log
        logAudit(req, 'VOID', 'sale', id, {
          metadata: {
            saleNumber: sale.sale_number,
            totalAmount: sale.total_amount,
            reason,
            originalPaymentMethod: sale.payment_method
          }
        });

        // Legacy audit trail
        db.run(
          `INSERT INTO audit_trail (company_id, user_id, event_type, event_category, event_data)
           VALUES (?, ?, ?, ?, ?)`,
          [companyId, userId, 'sale_voided', 'sales', JSON.stringify({
            saleId: id, saleNumber: sale.sale_number, totalAmount: sale.total_amount, reason
          })]
        );

        res.json({
          success: true,
          message: 'Sale voided successfully',
          saleId: id,
          saleNumber: sale.sale_number,
          voidedBy: userId,
          reason
        });
      }
    );
  });
});

// ========== PAYMENT REPORTS ==========

// Get payment method breakdown report
router.get('/reports/payment-methods', requirePermission('REPORTS.SALES'), (req, res) => {
  const companyId = req.user.companyId;
  const { startDate, endDate } = req.query;

  let dateFilter = '';
  const params = [companyId];

  if (startDate) { dateFilter += ' AND sp.created_at >= ?'; params.push(startDate); }
  if (endDate) { dateFilter += ' AND sp.created_at <= ?'; params.push(endDate); }

  const query = `
    SELECT 
      sp.payment_method,
      COUNT(*) as transaction_count,
      SUM(sp.amount) as total_amount,
      ROUND(AVG(sp.amount), 2) as avg_amount
    FROM sale_payments sp
    JOIN sales s ON sp.sale_id = s.id
    WHERE sp.company_id = ?
      AND sp.status = 'completed'
      AND s.voided_at IS NULL
      ${dateFilter}
    GROUP BY sp.payment_method
    ORDER BY total_amount DESC
  `;

  db.all(query, params, (err, breakdown) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    
    const total = breakdown.reduce((sum, b) => sum + parseFloat(b.total_amount || 0), 0);
    
    res.json({
      breakdown: breakdown.map(b => ({
        ...b,
        total_amount: parseFloat(b.total_amount || 0),
        avg_amount: parseFloat(b.avg_amount || 0),
        percentage: total > 0 ? Math.round((parseFloat(b.total_amount || 0) / total) * 10000) / 100 : 0
      })),
      grandTotal: total,
      dateRange: { start: startDate || 'all', end: endDate || 'all' }
    });
  });
});

// Cash-up report for a session
router.get('/reports/cash-up/:sessionId', requirePermission('REPORTS.SALES'), (req, res) => {
  const { sessionId } = req.params;
  const companyId = req.user.companyId;

  // Get session info
  db.get(`
    SELECT ts.*, t.till_name, u.full_name as cashier_name
    FROM till_sessions ts
    JOIN tills t ON ts.till_id = t.id
    JOIN users u ON ts.user_id = u.id
    WHERE ts.id = ? AND ts.company_id = ?
  `, [sessionId, companyId], (err, session) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // Get all sales in this session
    db.all(`
      SELECT s.id, s.sale_number, s.total_amount, s.payment_method, s.voided_at, s.void_reason, s.created_at
      FROM sales s WHERE s.till_session_id = ? AND s.company_id = ?
      ORDER BY s.created_at ASC
    `, [sessionId, companyId], (err, sales) => {
      if (err) return res.status(500).json({ error: 'Database error' });

      // Get payment breakdown from sale_payments
      db.all(`
        SELECT sp.payment_method, SUM(sp.amount) as total
        FROM sale_payments sp
        JOIN sales s ON sp.sale_id = s.id
        WHERE s.till_session_id = ? AND sp.company_id = ? AND s.voided_at IS NULL AND sp.status = 'completed'
        GROUP BY sp.payment_method
      `, [sessionId, companyId], (err, paymentBreakdown) => {
        const activeSales = sales.filter(s => !s.voided_at);
        const voidedSales = sales.filter(s => s.voided_at);
        const totalSales = activeSales.reduce((sum, s) => sum + parseFloat(s.total_amount), 0);
        const expectedCash = parseFloat(session.opening_balance || 0) +
          (paymentBreakdown || []).filter(p => p.payment_method === 'cash').reduce((sum, p) => sum + parseFloat(p.total), 0);

        res.json({
          session,
          summary: {
            totalSales,
            saleCount: activeSales.length,
            voidCount: voidedSales.length,
            openingBalance: parseFloat(session.opening_balance || 0),
            expectedCashInDrawer: expectedCash,
            closingBalance: session.closing_balance ? parseFloat(session.closing_balance) : null,
            variance: session.variance ? parseFloat(session.variance) : null
          },
          paymentBreakdown: (paymentBreakdown || []).map(p => ({
            method: p.payment_method,
            total: parseFloat(p.total)
          })),
          sales: activeSales,
          voidedSales
        });
      });
    });
  });
});

module.exports = router;
