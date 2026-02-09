/**
 * ============================================================================
 * Employee Routes - Enterprise User Management
 * ============================================================================
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { authenticateToken, requireCompany, requirePermission } = require('../middleware/auth');
const { getAllRoles, canManageRole } = require('../config/permissions');

const router = express.Router();

router.use(authenticateToken);
router.use(requireCompany);

/**
 * GET /api/employees
 * List all employees
 */
router.get('/', requirePermission('EMPLOYEES.VIEW'), (req, res) => {
  const companyId = req.user.companyId;
  const { location_id, status, role, search } = req.query;

  let query = `
    SELECT u.id, u.username, u.email, u.full_name, u.employee_id,
           u.department, u.hire_date, u.employment_status, u.hourly_rate,
           u.last_login_at, u.is_active, u.created_at,
           m.full_name as manager_name,
           uca.role as company_role
    FROM users u
    LEFT JOIN users m ON u.manager_user_id = m.id
    LEFT JOIN user_company_access uca ON u.id = uca.user_id AND uca.company_id = ?
    WHERE uca.company_id = ? AND uca.is_active = 1
  `;
  const params = [companyId, companyId];

  if (status && status !== 'all') {
    query += ' AND u.employment_status = ?';
    params.push(status);
  }

  if (role) {
    query += ' AND uca.role = ?';
    params.push(role);
  }

  if (search) {
    query += ' AND (u.full_name LIKE ? OR u.employee_id LIKE ? OR u.email LIKE ?)';
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  if (location_id) {
    query += ' AND u.id IN (SELECT user_id FROM user_location_access WHERE location_id = ? AND is_active = 1)';
    params.push(location_id);
  }

  query += ' ORDER BY u.full_name';

  db.all(query, params, (err, employees) => {
    if (err) {
      console.error('Error fetching employees:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ employees });
  });
});

/**
 * GET /api/employees/:id
 * Get employee details
 */
router.get('/:id', requirePermission('EMPLOYEES.VIEW'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  db.get(
    `SELECT u.*, m.full_name as manager_name, uca.role as company_role
     FROM users u
     LEFT JOIN users m ON u.manager_user_id = m.id
     LEFT JOIN user_company_access uca ON u.id = uca.user_id AND uca.company_id = ?
     WHERE u.id = ? AND uca.is_active = 1`,
    [companyId, id],
    (err, employee) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!employee) return res.status(404).json({ error: 'Employee not found' });

      // Get location assignments
      db.all(
        `SELECT ula.*, l.location_name, l.location_type
         FROM user_location_access ula
         JOIN locations l ON ula.location_id = l.id
         WHERE ula.user_id = ? AND ula.is_active = 1`,
        [id],
        (err, locations) => {
          employee.locations = locations || [];
          res.json({ employee });
        }
      );
    }
  );
});

/**
 * GET /api/employees/:id/direct-reports
 * Get employees reporting to this employee
 */
router.get('/:id/direct-reports', requirePermission('EMPLOYEES.VIEW'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  db.all(
    `SELECT u.id, u.full_name, u.employee_id, u.email, uca.role
     FROM users u
     JOIN user_company_access uca ON u.id = uca.user_id AND uca.company_id = ?
     WHERE u.manager_user_id = ? AND u.is_active = 1 AND uca.is_active = 1
     ORDER BY u.full_name`,
    [companyId, id],
    (err, reports) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ direct_reports: reports || [] });
    }
  );
});

/**
 * POST /api/employees
 * Create new employee
 */
router.post('/', requirePermission('EMPLOYEES.CREATE'), async (req, res) => {
  const companyId = req.user.companyId;
  const createdBy = req.user.userId;
  const {
    username, email, password, full_name, employee_id,
    role, department, manager_user_id, hire_date,
    hourly_rate, salary, location_id
  } = req.body;

  if (!username || !email || !password || !full_name || !role) {
    return res.status(400).json({ error: 'Username, email, password, full name, and role are required' });
  }

  // Check if user can assign this role
  if (!canManageRole(req.user.role, role)) {
    return res.status(403).json({ error: 'You cannot assign this role level' });
  }

  // Hash password
  const password_hash = await bcrypt.hash(password, 10);

  // Check for duplicate username/email
  db.get('SELECT id FROM users WHERE username = ? OR email = ?', [username, email], (err, existing) => {
    if (existing) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    db.run(
      `INSERT INTO users (username, email, password_hash, full_name, employee_id,
        user_type, department, manager_user_id, hire_date, hourly_rate, salary, employment_status)
       VALUES (?, ?, ?, ?, ?, 'company_user', ?, ?, ?, ?, ?, 'active')`,
      [username, email, password_hash, full_name, employee_id, department, manager_user_id, hire_date, hourly_rate, salary],
      function(err) {
        if (err) {
          console.error('Error creating employee:', err);
          return res.status(500).json({ error: 'Failed to create employee' });
        }

        const userId = this.lastID;

        // Add company access
        db.run(
          `INSERT INTO user_company_access (user_id, company_id, role, is_primary, granted_by_user_id)
           VALUES (?, ?, ?, 1, ?)`,
          [userId, companyId, role, createdBy],
          (err) => {
            if (err) console.error('Error adding company access:', err);

            // Add location access if provided
            if (location_id) {
              db.run(
                `INSERT INTO user_location_access (user_id, location_id, role, is_primary, granted_by_user_id)
                 VALUES (?, ?, ?, 1, ?)`,
                [userId, location_id, role, createdBy]
              );
            }

            // Log audit
            db.run(
              `INSERT INTO audit_trail (company_id, user_id, event_type, event_category, event_data)
               VALUES (?, ?, ?, ?, ?)`,
              [companyId, createdBy, 'employee_created', 'employees', JSON.stringify({ employee_id: userId, username })]
            );

            res.status(201).json({
              success: true,
              employee_id: userId,
              message: 'Employee created successfully'
            });
          }
        );
      }
    );
  });
});

/**
 * PUT /api/employees/:id
 * Update employee
 */
router.put('/:id', requirePermission('EMPLOYEES.EDIT'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const updatedBy = req.user.userId;
  const {
    full_name, employee_id, department, manager_user_id,
    hourly_rate, salary, role, profile_photo_url, email, username
  } = req.body;

  // First update user details
  db.run(
    `UPDATE users SET
      full_name = COALESCE(?, full_name),
      employee_id = COALESCE(?, employee_id),
      email = COALESCE(?, email),
      username = COALESCE(?, username),
      department = ?,
      manager_user_id = ?,
      hourly_rate = ?,
      salary = ?,
      profile_photo_url = ?
     WHERE id = ?`,
    [full_name, employee_id, email, username, department, manager_user_id, hourly_rate, salary, profile_photo_url, id],
    (err) => {
      if (err) {
        console.error('Failed to update employee:', err);
        return res.status(500).json({ error: 'Failed to update employee', details: err.message });
      }

      // Update role if provided
      if (role) {
        db.run(
          `UPDATE user_company_access SET role = ? WHERE user_id = ? AND company_id = ?`,
          [role, id, companyId],
          (roleErr) => {
            if (roleErr) console.error('Failed to update role:', roleErr);
          }
        );
      }

      // Log audit
      db.run(
        `INSERT INTO audit_trail (company_id, user_id, event_type, event_category, event_data)
         VALUES (?, ?, ?, ?, ?)`,
        [companyId, updatedBy, 'employee_updated', 'employees', JSON.stringify({ employee_id: id })]
      );

      res.json({ success: true, message: 'Employee updated successfully' });
    }
  );
});

/**
 * PUT /api/employees/:id/status
 * Update employment status
 */
router.put('/:id/status', requirePermission('EMPLOYEES.EDIT'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const { status, termination_date } = req.body;

  const validStatuses = ['active', 'on_leave', 'suspended', 'terminated'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const updates = { employment_status: status };
  if (status === 'terminated' && termination_date) {
    updates.termination_date = termination_date;
    updates.is_active = 0;
  }

  db.run(
    `UPDATE users SET employment_status = ?, termination_date = ?, is_active = ?
     WHERE id = ?`,
    [status, termination_date || null, status === 'terminated' ? 0 : 1, id],
    (err) => {
      if (err) return res.status(500).json({ error: 'Failed to update status' });

      // Log audit
      db.run(
        `INSERT INTO audit_trail (company_id, user_id, event_type, event_category, event_data)
         VALUES (?, ?, ?, ?, ?)`,
        [companyId, req.user.userId, 'employee_status_changed', 'employees', JSON.stringify({ employee_id: id, status })]
      );

      res.json({ success: true, message: 'Status updated' });
    }
  );
});

/**
 * PUT /api/employees/:id/transfer
 * Transfer employee to new location
 */
router.put('/:id/transfer', requirePermission('EMPLOYEES.EDIT'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const { from_location_id, to_location_id, new_role, effective_date } = req.body;

  if (!to_location_id) {
    return res.status(400).json({ error: 'Destination location required' });
  }

  // Deactivate old location access
  if (from_location_id) {
    db.run(
      `UPDATE user_location_access SET is_active = 0 WHERE user_id = ? AND location_id = ?`,
      [id, from_location_id]
    );
  }

  // Add new location access
  db.run(
    `INSERT INTO user_location_access (user_id, location_id, role, is_primary, granted_by_user_id)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(user_id, location_id) DO UPDATE SET
       role = excluded.role,
       is_primary = 1,
       is_active = 1`,
    [id, to_location_id, new_role || 'cashier', req.user.userId],
    (err) => {
      if (err) return res.status(500).json({ error: 'Failed to transfer employee' });

      // Log audit
      db.run(
        `INSERT INTO audit_trail (company_id, user_id, event_type, event_category, event_data)
         VALUES (?, ?, ?, ?, ?)`,
        [companyId, req.user.userId, 'employee_transferred', 'employees',
         JSON.stringify({ employee_id: id, from: from_location_id, to: to_location_id })]
      );

      res.json({ success: true, message: 'Employee transferred' });
    }
  );
});

/**
 * GET /api/employees/roles
 * Get available roles
 */
router.get('/meta/roles', (req, res) => {
  const roles = getAllRoles();
  res.json({ roles });
});

module.exports = router;
