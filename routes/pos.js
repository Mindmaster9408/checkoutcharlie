const express = require('express');
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Get all tills
router.get('/tills', (req, res) => {
  db.all('SELECT * FROM tills WHERE is_active = 1', [], (err, tills) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ tills });
  });
});

// Get till sessions
router.get('/sessions', (req, res) => {
  const { status } = req.query;
  let query = `
    SELECT ts.*, t.till_name, u.full_name as user_name
    FROM till_sessions ts
    JOIN tills t ON ts.till_id = t.id
    JOIN users u ON ts.user_id = u.id
  `;

  const params = [];
  if (status) {
    query += ' WHERE ts.status = ?';
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

  // Check if there's already an open session for this till
  db.get('SELECT * FROM till_sessions WHERE till_id = ? AND status = ?', [tillId, 'open'], (err, existingSession) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (existingSession) {
      return res.status(400).json({ error: 'This till already has an open session' });
    }

    db.run(
      'INSERT INTO till_sessions (till_id, user_id, opening_balance) VALUES (?, ?, ?)',
      [tillId, userId, openingBalance],
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

// Close till session
router.post('/sessions/:id/close', (req, res) => {
  const { id } = req.params;
  const { closingBalance, closing_balance, expectedBalance, expected_balance, variance, notes } = req.body;

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
    WHERE ts.id = ?
    GROUP BY ts.id
  `, [id], (err, session) => {
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
       WHERE id = ?`,
      [closingBal, finalExpected, finalVariance, notes, id],
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

// Get products
router.get('/products', (req, res) => {
  db.all('SELECT * FROM products WHERE is_active = 1 ORDER BY product_name', [], (err, products) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ products });
  });
});

// Generate next product code based on company prefix
router.get('/products/next-code/:prefix', (req, res) => {
  const prefix = req.params.prefix.toUpperCase().substring(0, 3);

  // Find the highest existing code with this prefix
  db.all(
    `SELECT product_code FROM products WHERE product_code LIKE ? ORDER BY product_code DESC LIMIT 1`,
    [`${prefix}%`],
    (err, results) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      let nextNumber = 1;

      if (results && results.length > 0) {
        const lastCode = results[0].product_code;
        // Extract the number part from the code (e.g., "ABC005" -> 5)
        const numberPart = lastCode.replace(prefix, '');
        const lastNumber = parseInt(numberPart, 10);
        if (!isNaN(lastNumber)) {
          nextNumber = lastNumber + 1;
        }
      }

      // Format with leading zeros (e.g., 001, 002, etc.)
      const nextCode = `${prefix}${String(nextNumber).padStart(3, '0')}`;

      res.json({ code: nextCode });
    }
  );
});

// Create product
router.post('/products', (req, res) => {
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
    `INSERT INTO products (product_code, product_name, category, unit_price, cost_price, is_active, barcode, requires_vat, vat_rate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
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
router.put('/products/:id', (req, res) => {
  const { id } = req.params;
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
     WHERE id = ?`,
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
      id
    ],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to update product' });
      }

      db.get('SELECT * FROM products WHERE id = ?', [id], (err, product) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        res.json({ product, message: 'Product updated successfully' });
      });
    }
  );
});

// Delete product (soft delete)
router.delete('/products/:id', (req, res) => {
  const { id } = req.params;

  db.run(
    'UPDATE products SET is_active = 0 WHERE id = ?',
    [id],
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
  const { tillSessionId, items, paymentMethod } = req.body;
  const userId = req.user.userId;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'No items in sale' });
  }

  // Verify till session is open
  db.get('SELECT * FROM till_sessions WHERE id = ? AND status = ?', [tillSessionId, 'open'], (err, session) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!session) {
      return res.status(400).json({ error: 'Till session not found or not open' });
    }

    // Get product details and verify stock
    const productIds = items.map(item => item.productId);
    const placeholders = productIds.map(() => '?').join(',');

    db.all(`SELECT * FROM products WHERE id IN (${placeholders})`, productIds, (err, products) => {
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
        `INSERT INTO sales (sale_number, till_session_id, user_id, subtotal, vat_amount, total_amount, payment_method)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [saleNumber, tillSessionId, userId, subtotal, vatAmount, totalAmount, paymentMethod],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Failed to create sale' });
          }

          const saleId = this.lastID;

          // Insert sale items and update stock
          const stmt = db.prepare('INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?)');
          const updateStmt = db.prepare('UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?');

          saleItems.forEach(item => {
            stmt.run(saleId, item.productId, item.quantity, item.unitPrice, item.totalPrice);
            updateStmt.run(item.quantity, item.productId);
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

  db.all(`
    SELECT s.*, u.full_name as cashier_name
    FROM sales s
    JOIN users u ON s.user_id = u.id
    WHERE s.till_session_id = ?
    ORDER BY s.created_at DESC
  `, [id], (err, sales) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ sales });
  });
});

module.exports = router;
