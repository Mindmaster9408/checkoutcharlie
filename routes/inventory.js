/**
 * ============================================================================
 * Inventory Routes - Multi-Location Stock Management
 * ============================================================================
 */

const express = require('express');
const db = require('../database');
const { authenticateToken, requireCompany, requirePermission } = require('../middleware/auth');

const router = express.Router();

router.use(authenticateToken);
router.use(requireCompany);

/**
 * GET /api/inventory
 * Get inventory levels across locations
 */
router.get('/', requirePermission('INVENTORY.VIEW'), (req, res) => {
  const companyId = req.user.companyId;
  const { location_id, product_id, low_stock, out_of_stock } = req.query;

  let query = `
    SELECT i.*, p.product_code, p.product_name, p.category, p.unit_price,
           l.location_name, l.location_code
    FROM inventory i
    JOIN products p ON i.product_id = p.id
    JOIN locations l ON i.location_id = l.id
    WHERE i.company_id = ?
  `;
  const params = [companyId];

  if (location_id) {
    query += ' AND i.location_id = ?';
    params.push(location_id);
  }

  if (product_id) {
    query += ' AND i.product_id = ?';
    params.push(product_id);
  }

  if (low_stock === 'true') {
    query += ' AND i.quantity_on_hand <= i.reorder_point';
  }

  if (out_of_stock === 'true') {
    query += ' AND (i.quantity_on_hand - i.quantity_reserved) <= 0';
  }

  query += ' ORDER BY l.location_name, p.product_name';

  db.all(query, params, (err, inventory) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ inventory });
  });
});

/**
 * GET /api/inventory/location/:id
 * Get inventory for specific location
 */
router.get('/location/:id', requirePermission('INVENTORY.VIEW'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  db.all(
    `SELECT i.*, p.product_code, p.product_name, p.category, p.unit_price, p.cost_price,
            (i.quantity_on_hand * p.cost_price) as stock_value
     FROM inventory i
     JOIN products p ON i.product_id = p.id
     WHERE i.company_id = ? AND i.location_id = ?
     ORDER BY p.product_name`,
    [companyId, id],
    (err, inventory) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ inventory });
    }
  );
});

/**
 * GET /api/inventory/product/:id
 * Get product inventory across all locations
 */
router.get('/product/:id', requirePermission('INVENTORY.VIEW'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  db.all(
    `SELECT i.*, l.location_name, l.location_code, l.location_type
     FROM inventory i
     JOIN locations l ON i.location_id = l.id
     WHERE i.company_id = ? AND i.product_id = ?
     ORDER BY l.location_name`,
    [companyId, id],
    (err, inventory) => {
      if (err) return res.status(500).json({ error: 'Database error' });

      // Calculate totals
      const totals = inventory.reduce((acc, loc) => {
        acc.total_on_hand += loc.quantity_on_hand || 0;
        acc.total_reserved += loc.quantity_reserved || 0;
        acc.total_on_order += loc.quantity_on_order || 0;
        acc.total_in_transit += loc.quantity_in_transit || 0;
        return acc;
      }, { total_on_hand: 0, total_reserved: 0, total_on_order: 0, total_in_transit: 0 });

      res.json({ inventory, totals });
    }
  );
});

/**
 * GET /api/inventory/low-stock
 * Get items below reorder point
 */
router.get('/low-stock', requirePermission('INVENTORY.VIEW'), (req, res) => {
  const companyId = req.user.companyId;
  const { location_id } = req.query;

  let query = `
    SELECT i.*, p.product_code, p.product_name, l.location_name,
           (i.reorder_point - i.quantity_on_hand) as shortage
    FROM inventory i
    JOIN products p ON i.product_id = p.id
    JOIN locations l ON i.location_id = l.id
    WHERE i.company_id = ? AND i.quantity_on_hand <= i.reorder_point AND i.reorder_point > 0
  `;
  const params = [companyId];

  if (location_id) {
    query += ' AND i.location_id = ?';
    params.push(location_id);
  }

  query += ' ORDER BY shortage DESC';

  db.all(query, params, (err, items) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ low_stock_items: items });
  });
});

/**
 * POST /api/inventory/adjust
 * Adjust inventory at a location
 */
router.post('/adjust', requirePermission('INVENTORY.MANAGE'), (req, res) => {
  const companyId = req.user.companyId;
  const userId = req.user.userId;
  const { product_id, location_id, adjustment_type, quantity, reason } = req.body;

  if (!product_id || !location_id || !adjustment_type || quantity === undefined) {
    return res.status(400).json({ error: 'Product, location, adjustment type, and quantity required' });
  }

  const validTypes = ['add', 'remove', 'set', 'count', 'damage', 'theft', 'return'];
  if (!validTypes.includes(adjustment_type)) {
    return res.status(400).json({ error: 'Invalid adjustment type' });
  }

  // Get current inventory
  db.get(
    'SELECT * FROM inventory WHERE product_id = ? AND location_id = ? AND company_id = ?',
    [product_id, location_id, companyId],
    (err, current) => {
      let newQty;
      const currentQty = current ? current.quantity_on_hand : 0;

      switch (adjustment_type) {
        case 'add':
        case 'return':
          newQty = currentQty + quantity;
          break;
        case 'remove':
        case 'damage':
        case 'theft':
          newQty = Math.max(0, currentQty - quantity);
          break;
        case 'set':
        case 'count':
          newQty = quantity;
          break;
      }

      // Update or insert inventory
      db.run(
        `INSERT INTO inventory (company_id, product_id, location_id, quantity_on_hand)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(product_id, location_id, COALESCE(warehouse_id, 0)) DO UPDATE SET
           quantity_on_hand = excluded.quantity_on_hand,
           updated_at = CURRENT_TIMESTAMP`,
        [companyId, product_id, location_id, newQty],
        (err) => {
          if (err) return res.status(500).json({ error: 'Failed to adjust inventory' });

          // Log stock adjustment
          db.run(
            `INSERT INTO stock_adjustments (company_id, product_id, location_id, adjustment_type,
              quantity_change, quantity_before, quantity_after, reason, adjusted_by_user_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [companyId, product_id, location_id, adjustment_type,
             adjustment_type === 'set' || adjustment_type === 'count' ? newQty - currentQty : quantity,
             currentQty, newQty, reason, userId]
          );

          res.json({
            success: true,
            previous_quantity: currentQty,
            new_quantity: newQty
          });
        }
      );
    }
  );
});

/**
 * POST /api/inventory/count
 * Submit inventory count (stock take)
 */
router.post('/count', requirePermission('STOCK.STOCK_TAKE'), (req, res) => {
  const companyId = req.user.companyId;
  const userId = req.user.userId;
  const { location_id, counts } = req.body;

  if (!location_id || !counts || !Array.isArray(counts)) {
    return res.status(400).json({ error: 'Location and counts array required' });
  }

  let processed = 0;
  const results = [];

  counts.forEach(({ product_id, counted_quantity }) => {
    db.get(
      'SELECT quantity_on_hand FROM inventory WHERE product_id = ? AND location_id = ? AND company_id = ?',
      [product_id, location_id, companyId],
      (err, current) => {
        const currentQty = current ? current.quantity_on_hand : 0;
        const variance = counted_quantity - currentQty;

        // Update inventory
        db.run(
          `INSERT INTO inventory (company_id, product_id, location_id, quantity_on_hand, last_counted_at)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(product_id, location_id, COALESCE(warehouse_id, 0)) DO UPDATE SET
             quantity_on_hand = excluded.quantity_on_hand,
             last_counted_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP`,
          [companyId, product_id, location_id, counted_quantity],
          () => {
            // Log adjustment
            if (variance !== 0) {
              db.run(
                `INSERT INTO stock_adjustments (company_id, product_id, location_id, adjustment_type,
                  quantity_change, quantity_before, quantity_after, reason, adjusted_by_user_id)
                 VALUES (?, ?, ?, 'count', ?, ?, ?, 'Stock take adjustment', ?)`,
                [companyId, product_id, location_id, variance, currentQty, counted_quantity, userId]
              );
            }

            results.push({ product_id, previous: currentQty, counted: counted_quantity, variance });
            processed++;

            if (processed === counts.length) {
              res.json({ success: true, results });
            }
          }
        );
      }
    );
  });
});

/**
 * GET /api/inventory/movements
 * Get inventory movement history
 */
router.get('/movements', requirePermission('INVENTORY.VIEW'), (req, res) => {
  const companyId = req.user.companyId;
  const { location_id, product_id, start_date, end_date, limit } = req.query;

  let query = `
    SELECT sa.*, p.product_code, p.product_name, l.location_name, u.full_name as adjusted_by
    FROM stock_adjustments sa
    JOIN products p ON sa.product_id = p.id
    JOIN locations l ON sa.location_id = l.id
    LEFT JOIN users u ON sa.adjusted_by_user_id = u.id
    WHERE sa.company_id = ?
  `;
  const params = [companyId];

  if (location_id) {
    query += ' AND sa.location_id = ?';
    params.push(location_id);
  }

  if (product_id) {
    query += ' AND sa.product_id = ?';
    params.push(product_id);
  }

  if (start_date) {
    query += ' AND DATE(sa.created_at) >= ?';
    params.push(start_date);
  }

  if (end_date) {
    query += ' AND DATE(sa.created_at) <= ?';
    params.push(end_date);
  }

  query += ` ORDER BY sa.created_at DESC LIMIT ?`;
  params.push(parseInt(limit) || 100);

  db.all(query, params, (err, movements) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ movements });
  });
});

/**
 * GET /api/inventory/valuation
 * Get inventory valuation report
 */
router.get('/valuation', requirePermission('INVENTORY.VIEW'), (req, res) => {
  const companyId = req.user.companyId;
  const { location_id } = req.query;

  let query = `
    SELECT l.id as location_id, l.location_name,
           COUNT(i.id) as item_count,
           SUM(i.quantity_on_hand) as total_units,
           SUM(i.quantity_on_hand * p.cost_price) as cost_value,
           SUM(i.quantity_on_hand * p.unit_price) as retail_value
    FROM inventory i
    JOIN products p ON i.product_id = p.id
    JOIN locations l ON i.location_id = l.id
    WHERE i.company_id = ?
  `;
  const params = [companyId];

  if (location_id) {
    query += ' AND i.location_id = ?';
    params.push(location_id);
  }

  query += ' GROUP BY l.id, l.location_name ORDER BY l.location_name';

  db.all(query, params, (err, valuation) => {
    if (err) return res.status(500).json({ error: 'Database error' });

    const totals = valuation.reduce((acc, loc) => {
      acc.total_items += loc.item_count;
      acc.total_units += loc.total_units;
      acc.total_cost_value += loc.cost_value || 0;
      acc.total_retail_value += loc.retail_value || 0;
      return acc;
    }, { total_items: 0, total_units: 0, total_cost_value: 0, total_retail_value: 0 });

    res.json({ valuation, totals });
  });
});

module.exports = router;
