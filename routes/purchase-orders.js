/**
 * ============================================================================
 * Purchase Order Routes
 * ============================================================================
 */

const express = require('express');
const db = require('../database');
const { authenticateToken, requireCompany, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);
router.use(requireCompany);

router.get('/', requirePermission('PURCHASE_ORDERS.VIEW'), (req, res) => {
  const companyId = req.user.companyId;
  const { status, supplier_id, location_id } = req.query;

  let query = `
    SELECT po.*, s.supplier_name, l.location_name, cu.full_name as created_by_name
    FROM purchase_orders po
    JOIN suppliers s ON po.supplier_id = s.id
    JOIN locations l ON po.delivery_location_id = l.id
    JOIN users cu ON po.created_by_user_id = cu.id
    WHERE po.company_id = ?`;
  const params = [companyId];

  if (status) { query += ' AND po.status = ?'; params.push(status); }
  if (supplier_id) { query += ' AND po.supplier_id = ?'; params.push(supplier_id); }
  if (location_id) { query += ' AND po.delivery_location_id = ?'; params.push(location_id); }
  query += ' ORDER BY po.created_at DESC';

  db.all(query, params, (err, orders) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ orders });
  });
});

router.get('/:id', requirePermission('PURCHASE_ORDERS.VIEW'), (req, res) => {
  const { id } = req.params;
  db.get(`SELECT po.*, s.supplier_name, l.location_name FROM purchase_orders po
    JOIN suppliers s ON po.supplier_id = s.id JOIN locations l ON po.delivery_location_id = l.id
    WHERE po.id = ? AND po.company_id = ?`, [id, req.user.companyId], (err, order) => {
      if (!order) return res.status(404).json({ error: 'Order not found' });
      db.all(`SELECT poi.*, p.product_code, p.product_name FROM purchase_order_items poi
        JOIN products p ON poi.product_id = p.id WHERE poi.purchase_order_id = ?`, [id], (err, items) => {
          order.items = items || [];
          res.json({ order });
        });
    });
});

router.post('/', requirePermission('PURCHASE_ORDERS.CREATE'), (req, res) => {
  const companyId = req.user.companyId;
  const createdBy = req.user.userId;
  const { supplier_id, delivery_location_id, items, expected_delivery_date, notes } = req.body;

  if (!supplier_id || !delivery_location_id || !items || items.length === 0) {
    return res.status(400).json({ error: 'Supplier, location, and items required' });
  }

  const poNumber = `PO-${Date.now().toString(36).toUpperCase()}`;
  const totals = items.reduce((acc, i) => {
    acc.subtotal += i.quantity * i.unit_cost;
    return acc;
  }, { subtotal: 0 });
  const taxAmount = totals.subtotal * 0.15;
  const totalAmount = totals.subtotal + taxAmount;

  db.run(
    `INSERT INTO purchase_orders (company_id, po_number, supplier_id, delivery_location_id,
      order_date, expected_delivery_date, subtotal, tax_amount, total_amount, notes, created_by_user_id)
     VALUES (?, ?, ?, ?, DATE('now'), ?, ?, ?, ?, ?, ?)`,
    [companyId, poNumber, supplier_id, delivery_location_id, expected_delivery_date,
     totals.subtotal, taxAmount, totalAmount, notes, createdBy],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to create PO' });
      const poId = this.lastID;

      items.forEach(item => {
        db.run(`INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity_ordered, unit_cost, total_cost)
          VALUES (?, ?, ?, ?, ?)`, [poId, item.product_id, item.quantity, item.unit_cost, item.quantity * item.unit_cost]);
      });

      res.status(201).json({ success: true, po_id: poId, po_number: poNumber });
    }
  );
});

router.post('/:id/approve', requirePermission('PURCHASE_ORDERS.APPROVE'), (req, res) => {
  const { id } = req.params;
  db.run(`UPDATE purchase_orders SET status = 'approved', approved_by_user_id = ?, approved_at = CURRENT_TIMESTAMP
    WHERE id = ? AND company_id = ? AND status = 'draft'`,
    [req.user.userId, id, req.user.companyId], function(err) {
      if (err || this.changes === 0) return res.status(400).json({ error: 'Failed to approve' });
      res.json({ success: true });
    });
});

router.post('/:id/send', requirePermission('PURCHASE_ORDERS.VIEW'), (req, res) => {
  const { id } = req.params;
  db.run(`UPDATE purchase_orders SET status = 'sent' WHERE id = ? AND company_id = ? AND status = 'approved'`,
    [id, req.user.companyId], function(err) {
      if (err || this.changes === 0) return res.status(400).json({ error: 'Failed to send' });
      res.json({ success: true });
    });
});

router.post('/:id/receive', requirePermission('PURCHASE_ORDERS.RECEIVE'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const { items } = req.body;

  db.get('SELECT * FROM purchase_orders WHERE id = ? AND company_id = ?', [id, companyId], (err, po) => {
    if (!po) return res.status(404).json({ error: 'PO not found' });

    const grnNumber = `GRN-${Date.now().toString(36).toUpperCase()}`;

    db.run(`INSERT INTO goods_receipts (company_id, grn_number, purchase_order_id, supplier_id, location_id, received_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?)`, [companyId, grnNumber, id, po.supplier_id, po.delivery_location_id, req.user.userId],
      function(grnErr) {
        if (grnErr) return res.status(500).json({ error: 'Failed to create GRN' });
        const grnId = this.lastID;

        items.forEach(item => {
          db.run(`INSERT INTO goods_receipt_items (goods_receipt_id, po_item_id, product_id, quantity_received, quantity_accepted)
            VALUES (?, ?, ?, ?, ?)`, [grnId, item.po_item_id, item.product_id, item.quantity_received, item.quantity_accepted]);

          db.run(`UPDATE purchase_order_items SET quantity_received = quantity_received + ? WHERE id = ?`,
            [item.quantity_received, item.po_item_id]);

          db.run(`INSERT INTO inventory (company_id, product_id, location_id, quantity_on_hand, last_received_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(product_id, location_id, COALESCE(warehouse_id, 0)) DO UPDATE SET
              quantity_on_hand = quantity_on_hand + excluded.quantity_on_hand, last_received_at = CURRENT_TIMESTAMP`,
            [companyId, item.product_id, po.delivery_location_id, item.quantity_accepted]);
        });

        db.run(`UPDATE purchase_orders SET status = 'received', actual_delivery_date = DATE('now') WHERE id = ?`, [id]);
        res.json({ success: true, grn_number: grnNumber });
      });
  });
});

module.exports = router;
