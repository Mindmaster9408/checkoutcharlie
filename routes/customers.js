const express = require('express');
const db = require('../database');
const { authenticateToken, requireCompany, requirePermission } = require('../middleware/auth');

const router = express.Router();

// Apply authentication and company context to all routes
router.use(authenticateToken);
router.use(requireCompany);

// Get all customers
router.get('/', requirePermission('CUSTOMERS.VIEW'), (req, res) => {
  const { active_only } = req.query;
  const companyId = req.user.companyId;
  let query = 'SELECT * FROM customers WHERE company_id = ?';
  const params = [companyId];

  if (active_only === 'true') {
    query += ' AND is_active = 1';
  }

  query += ' ORDER BY name ASC';

  db.all(query, params, (err, customers) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ customers });
  });
});

// Search customers
router.get('/search', (req, res) => {
  const { q } = req.query;
  const companyId = req.user.companyId;
  const role = req.user.role;

  if (!q || q.trim() === '') {
    return res.json({ customers: [] });
  }

  const searchTerm = `%${q}%`;

  // Cashiers only get name field
  if (role === 'cashier') {
    db.all(
      `SELECT id, name FROM customers
       WHERE company_id = ? AND (name LIKE ?)
       AND is_active = 1
       ORDER BY name ASC
       LIMIT 20`,
      [companyId, searchTerm],
      (err, customers) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        res.json({ customers });
      }
    );
  } else {
    db.all(
      `SELECT * FROM customers
       WHERE company_id = ? AND (name LIKE ? OR contact_number LIKE ? OR email LIKE ? OR company LIKE ?)
       AND is_active = 1
       ORDER BY name ASC
       LIMIT 20`,
      [companyId, searchTerm, searchTerm, searchTerm, searchTerm],
      (err, customers) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        res.json({ customers });
      }
    );
  }
});

// Get single customer
router.get('/:id', requirePermission('CUSTOMERS.VIEW'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  db.get('SELECT * FROM customers WHERE id = ? AND company_id = ?', [id, companyId], (err, customer) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json({ customer });
  });
});

// Create customer
router.post('/', requirePermission('CUSTOMERS.CREATE'), (req, res) => {
  const {
    name,
    contact_person,
    contact_number,
    email,
    address_line_1,
    address_line_2,
    suburb,
    city,
    province,
    postal_code,
    tax_reference,
    company,
    customer_type,
    custom_field,
    is_active
  } = req.body;
  const companyId = req.user.companyId;

  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Name is required' });
  }

  db.run(
    `INSERT INTO customers
     (company_id, name, contact_person, contact_number, email, address_line_1, address_line_2, suburb, city, province, postal_code, tax_reference, company, customer_type, custom_field, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      companyId,
      name,
      contact_person || null,
      contact_number || null,
      email || null,
      address_line_1 || null,
      address_line_2 || null,
      suburb || null,
      city || null,
      province || null,
      postal_code || null,
      tax_reference || null,
      company || null,
      customer_type || 'Cash Sale Customer',
      custom_field || null,
      is_active !== false ? 1 : 0
    ],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to create customer' });
      }

      db.get('SELECT * FROM customers WHERE id = ?', [this.lastID], (err, customer) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        res.json({ customer, message: 'Customer created successfully' });
      });
    }
  );
});

// Update customer
router.put('/:id', requirePermission('CUSTOMERS.EDIT'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const {
    name,
    contact_person,
    contact_number,
    email,
    address_line_1,
    address_line_2,
    suburb,
    city,
    province,
    postal_code,
    tax_reference,
    company,
    customer_type,
    custom_field,
    is_active
  } = req.body;

  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Name is required' });
  }

  db.run(
    `UPDATE customers
     SET name = ?, contact_person = ?, contact_number = ?, email = ?, address_line_1 = ?, address_line_2 = ?, suburb = ?, city = ?, province = ?, postal_code = ?, tax_reference = ?, company = ?, customer_type = ?, custom_field = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND company_id = ?`,
    [
      name,
      contact_person || null,
      contact_number || null,
      email || null,
      address_line_1 || null,
      address_line_2 || null,
      suburb || null,
      city || null,
      province || null,
      postal_code || null,
      tax_reference || null,
      company || null,
      customer_type || 'Cash Sale Customer',
      custom_field || null,
      is_active !== false ? 1 : 0,
      id,
      companyId
    ],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to update customer' });
      }

      db.get('SELECT * FROM customers WHERE id = ? AND company_id = ?', [id, companyId], (err, customer) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        res.json({ customer, message: 'Customer updated successfully' });
      });
    }
  );
});

// Delete customer (soft delete)
router.delete('/:id', requirePermission('CUSTOMERS.DELETE'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  db.run(
    'UPDATE customers SET is_active = 0 WHERE id = ? AND company_id = ?',
    [id, companyId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to delete customer' });
      }
      res.json({ message: 'Customer deleted successfully' });
    }
  );
});

module.exports = router;
