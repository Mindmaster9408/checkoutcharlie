const express = require('express');
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Get all customers
router.get('/', (req, res) => {
  const { active_only } = req.query;
  let query = 'SELECT * FROM customers';
  const params = [];

  if (active_only === 'true') {
    query += ' WHERE is_active = 1';
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

  if (!q || q.trim() === '') {
    return res.json({ customers: [] });
  }

  const searchTerm = `%${q}%`;
  db.all(
    `SELECT * FROM customers 
     WHERE (name LIKE ? OR contact_number LIKE ? OR email LIKE ? OR company LIKE ?)
     AND is_active = 1
     ORDER BY name ASC
     LIMIT 20`,
    [searchTerm, searchTerm, searchTerm, searchTerm],
    (err, customers) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ customers });
    }
  );
});

// Get single customer
router.get('/:id', (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM customers WHERE id = ?', [id], (err, customer) => {
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
router.post('/', (req, res) => {
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
    `INSERT INTO customers 
     (name, contact_person, contact_number, email, address_line_1, address_line_2, suburb, city, province, postal_code, tax_reference, company, customer_type, custom_field, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
router.put('/:id', (req, res) => {
  const { id } = req.params;
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
     WHERE id = ?`,
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
      id
    ],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to update customer' });
      }

      db.get('SELECT * FROM customers WHERE id = ?', [id], (err, customer) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        res.json({ customer, message: 'Customer updated successfully' });
      });
    }
  );
});

// Delete customer (soft delete)
router.delete('/:id', (req, res) => {
  const { id } = req.params;

  db.run(
    'UPDATE customers SET is_active = 0 WHERE id = ?',
    [id],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to delete customer' });
      }
      res.json({ message: 'Customer deleted successfully' });
    }
  );
});

module.exports = router;
