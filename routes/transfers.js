/**
 * ============================================================================
 * Stock Transfer Routes - Inter-Location Transfers
 * ============================================================================
 */

const express = require('express');
const db = require('../database');
const { authenticateToken, requireCompany, requirePermission } = require('../middleware/auth');

const router = express.Router();

router.use(authenticateToken);
router.use(requireCompany);

/**
 * GET /api/transfers
 * List stock transfers
 */
router.get('/', requirePermission('INVENTORY.VIEW'), (req, res) => {
  const companyId = req.user.companyId;
  const { status, from_location, to_location } = req.query;

  let query = `
    SELECT st.*, fl.location_name as from_location_name, tl.location_name as to_location_name,
           ru.full_name as requested_by_name, au.full_name as approved_by_name,
           (SELECT COUNT(*) FROM stock_transfer_items WHERE transfer_id = st.id) as item_count
    FROM stock_transfers st
    JOIN locations fl ON st.from_location_id = fl.id
    JOIN locations tl ON st.to_location_id = tl.id
    JOIN users ru ON st.requested_by_user_id = ru.id
    LEFT JOIN users au ON st.approved_by_user_id = au.id
    WHERE st.company_id = ?
  `;
  const params = [companyId];

  if (status) {
    query += ' AND st.status = ?';
    params.push(status);
  }
  if (from_location) {
    query += ' AND st.from_location_id = ?';
    params.push(from_location);
  }
  if (to_location) {
    query += ' AND st.to_location_id = ?';
    params.push(to_location);
  }

  query += ' ORDER BY st.created_at DESC';

  db.all(query, params, (err, transfers) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ transfers });
  });
});

/**
 * GET /api/transfers/:id
 * Get transfer details with items
 */
router.get('/:id', requirePermission('INVENTORY.VIEW'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  db.get(
    `SELECT st.*, fl.location_name as from_location_name, tl.location_name as to_location_name
     FROM stock_transfers st
     JOIN locations fl ON st.from_location_id = fl.id
     JOIN locations tl ON st.to_location_id = tl.id
     WHERE st.id = ? AND st.company_id = ?`,
    [id, companyId],
    (err, transfer) => {
      if (!transfer) return res.status(404).json({ error: 'Transfer not found' });

      db.all(
        `SELECT sti.*, p.product_code, p.product_name
         FROM stock_transfer_items sti
         JOIN products p ON sti.product_id = p.id
         WHERE sti.transfer_id = ?`,
        [id],
        (err, items) => {
          transfer.items = items || [];
          res.json({ transfer });
        }
      );
    }
  );
});

/**
 * POST /api/transfers
 * Create transfer request
 */
router.post('/', requirePermission('INVENTORY.TRANSFER_REQUEST'), (req, res) => {
  const companyId = req.user.companyId;
  const requestedBy = req.user.userId;
  const { from_location_id, to_location_id, items, notes, expected_arrival_date } = req.body;

  if (!from_location_id || !to_location_id || !items || items.length === 0) {
    return res.status(400).json({ error: 'Source, destination, and items required' });
  }

  // Generate transfer number
  const transferNumber = `TRF-${Date.now().toString(36).toUpperCase()}`;

  db.run(
    `INSERT INTO stock_transfers (company_id, transfer_number, from_location_id, to_location_id,
      requested_by_user_id, expected_arrival_date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [companyId, transferNumber, from_location_id, to_location_id, requestedBy, expected_arrival_date, notes],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to create transfer' });

      const transferId = this.lastID;

      // Add items
      items.forEach(item => {
        db.run(
          `INSERT INTO stock_transfer_items (transfer_id, product_id, quantity_requested)
           VALUES (?, ?, ?)`,
          [transferId, item.product_id, item.quantity]
        );
      });

      res.status(201).json({ success: true, transfer_id: transferId, transfer_number: transferNumber });
    }
  );
});

/**
 * POST /api/transfers/:id/approve
 * Approve transfer
 */
router.post('/:id/approve', requirePermission('INVENTORY.TRANSFER_APPROVE'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const approvedBy = req.user.userId;

  db.run(
    `UPDATE stock_transfers SET status = 'approved', approved_by_user_id = ?
     WHERE id = ? AND company_id = ? AND status = 'draft'`,
    [approvedBy, id, companyId],
    function(err) {
      if (err || this.changes === 0) return res.status(400).json({ error: 'Failed to approve' });
      res.json({ success: true });
    }
  );
});

/**
 * POST /api/transfers/:id/ship
 * Mark transfer as shipped
 */
router.post('/:id/ship', requirePermission('INVENTORY.TRANSFER_REQUEST'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const { items } = req.body; // { product_id, quantity_shipped }

  db.get('SELECT * FROM stock_transfers WHERE id = ? AND company_id = ?', [id, companyId], (err, transfer) => {
    if (!transfer || transfer.status !== 'approved') {
      return res.status(400).json({ error: 'Transfer not approved or not found' });
    }

    // Update shipped quantities and reduce source inventory
    if (items) {
      items.forEach(item => {
        db.run(
          'UPDATE stock_transfer_items SET quantity_shipped = ? WHERE transfer_id = ? AND product_id = ?',
          [item.quantity_shipped, id, item.product_id]
        );

        // Reduce source inventory and mark as in transit
        db.run(
          `UPDATE inventory SET
            quantity_on_hand = quantity_on_hand - ?,
            quantity_in_transit = quantity_in_transit + ?
           WHERE product_id = ? AND location_id = ? AND company_id = ?`,
          [item.quantity_shipped, item.quantity_shipped, item.product_id, transfer.from_location_id, companyId]
        );
      });
    }

    db.run(
      `UPDATE stock_transfers SET status = 'in_transit', shipped_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id],
      (err) => {
        if (err) return res.status(500).json({ error: 'Failed to update transfer' });
        res.json({ success: true });
      }
    );
  });
});

/**
 * POST /api/transfers/:id/receive
 * Receive transfer at destination
 */
router.post('/:id/receive', requirePermission('INVENTORY.TRANSFER_RECEIVE'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const { items } = req.body; // { product_id, quantity_received, variance_reason }

  db.get('SELECT * FROM stock_transfers WHERE id = ? AND company_id = ?', [id, companyId], (err, transfer) => {
    if (!transfer || transfer.status !== 'in_transit') {
      return res.status(400).json({ error: 'Transfer not in transit or not found' });
    }

    // Update received quantities and destination inventory
    if (items) {
      items.forEach(item => {
        db.run(
          'UPDATE stock_transfer_items SET quantity_received = ?, variance_reason = ? WHERE transfer_id = ? AND product_id = ?',
          [item.quantity_received, item.variance_reason, id, item.product_id]
        );

        // Add to destination inventory
        db.run(
          `INSERT INTO inventory (company_id, product_id, location_id, quantity_on_hand, last_received_at)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(product_id, location_id, COALESCE(warehouse_id, 0)) DO UPDATE SET
             quantity_on_hand = quantity_on_hand + excluded.quantity_on_hand,
             last_received_at = CURRENT_TIMESTAMP`,
          [companyId, item.product_id, transfer.to_location_id, item.quantity_received]
        );

        // Clear in transit from source
        db.run(
          `UPDATE inventory SET quantity_in_transit = quantity_in_transit - ?
           WHERE product_id = ? AND location_id = ? AND company_id = ?`,
          [item.quantity_received, item.product_id, transfer.from_location_id, companyId]
        );
      });
    }

    db.run(
      `UPDATE stock_transfers SET status = 'received', received_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id],
      (err) => {
        if (err) return res.status(500).json({ error: 'Failed to complete transfer' });
        res.json({ success: true });
      }
    );
  });
});

module.exports = router;
