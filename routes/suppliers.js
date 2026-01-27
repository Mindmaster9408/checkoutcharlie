/**
 * ============================================================================
 * Supplier Routes - Vendor Management
 * ============================================================================
 */

const express = require('express');
const db = require('../database');
const { authenticateToken, requireCompany, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);
router.use(requireCompany);

router.get('/', requirePermission('SUPPLIERS.VIEW'), (req, res) => {
  const companyId = req.user.companyId;
  const { active_only, search } = req.query;

  let query = 'SELECT * FROM suppliers WHERE company_id = ?';
  const params = [companyId];

  if (active_only !== 'false') query += ' AND is_active = 1';
  if (search) {
    query += ' AND (supplier_name LIKE ? OR supplier_code LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  query += ' ORDER BY supplier_name';

  db.all(query, params, (err, suppliers) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ suppliers });
  });
});

router.get('/:id', requirePermission('SUPPLIERS.VIEW'), (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM suppliers WHERE id = ? AND company_id = ?', [id, req.user.companyId], (err, supplier) => {
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
    res.json({ supplier });
  });
});

router.post('/', requirePermission('SUPPLIERS.CREATE'), (req, res) => {
  const companyId = req.user.companyId;
  const { supplier_code, supplier_name, contact_name, contact_email, contact_phone, address,
          payment_terms, credit_limit, lead_time_days, minimum_order_value, tax_reference,
          bank_name, bank_account, bank_branch_code } = req.body;

  if (!supplier_code || !supplier_name) {
    return res.status(400).json({ error: 'Supplier code and name required' });
  }

  db.run(
    `INSERT INTO suppliers (company_id, supplier_code, supplier_name, contact_name, contact_email,
      contact_phone, address, payment_terms, credit_limit, lead_time_days, minimum_order_value,
      tax_reference, bank_name, bank_account, bank_branch_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [companyId, supplier_code, supplier_name, contact_name, contact_email, contact_phone, address,
     payment_terms || 30, credit_limit, lead_time_days || 7, minimum_order_value,
     tax_reference, bank_name, bank_account, bank_branch_code],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to create supplier' });
      res.status(201).json({ success: true, supplier_id: this.lastID });
    }
  );
});

router.put('/:id', requirePermission('SUPPLIERS.EDIT'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const fields = req.body;

  const updates = Object.keys(fields).filter(k => k !== 'id' && k !== 'company_id')
    .map(k => `${k} = ?`).join(', ');
  const values = Object.keys(fields).filter(k => k !== 'id' && k !== 'company_id')
    .map(k => fields[k]);

  db.run(`UPDATE suppliers SET ${updates}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?`,
    [...values, id, companyId], (err) => {
      if (err) return res.status(500).json({ error: 'Failed to update' });
      res.json({ success: true });
    });
});

router.delete('/:id', requirePermission('SUPPLIERS.DELETE'), (req, res) => {
  const { id } = req.params;
  db.run('UPDATE suppliers SET is_active = 0 WHERE id = ? AND company_id = ?',
    [id, req.user.companyId], (err) => {
      if (err) return res.status(500).json({ error: 'Failed to delete' });
      res.json({ success: true });
    });
});

router.get('/:id/products', requirePermission('SUPPLIERS.VIEW'), (req, res) => {
  const { id } = req.params;
  db.all(
    `SELECT ps.*, p.product_code, p.product_name FROM product_suppliers ps
     JOIN products p ON ps.product_id = p.id WHERE ps.supplier_id = ?`,
    [id], (err, products) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ products });
    });
});

module.exports = router;
