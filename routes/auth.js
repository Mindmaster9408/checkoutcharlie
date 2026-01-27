/**
 * ============================================================================
 * Authentication Routes - Multi-Tenant POS System
 * ============================================================================
 * Handles login, company selection, and user registration.
 * ============================================================================
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');
const { canAccessMultipleCompanies, getRolePermissions } = require('../config/permissions');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

/**
 * POST /api/auth/login
 * Initial login - returns token and list of accessible companies
 */
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  db.get('SELECT * FROM users WHERE username = ? AND is_active = 1', [username], async (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Get user's accessible companies
    const userType = user.user_type || 'company_user';

    // Build query based on user type
    let companiesQuery;
    let companiesParams;

    if (userType === 'accountant' && user.accounting_firm_id) {
      // Accountants access companies via their firm
      companiesQuery = `
        SELECT c.id, c.company_name, c.trading_name, 'accountant' as role
        FROM companies c
        JOIN firm_company_access fca ON c.id = fca.company_id
        WHERE fca.firm_id = ? AND fca.is_active = 1 AND c.is_active = 1
        ORDER BY c.company_name
      `;
      companiesParams = [user.accounting_firm_id];
    } else {
      // Business owners, admins, cashiers access via user_company_access
      companiesQuery = `
        SELECT c.id, c.company_name, c.trading_name, uca.role, uca.is_primary
        FROM companies c
        JOIN user_company_access uca ON c.id = uca.company_id
        WHERE uca.user_id = ? AND uca.is_active = 1 AND c.is_active = 1
        ORDER BY uca.is_primary DESC, c.company_name ASC
      `;
      companiesParams = [user.id];
    }

    db.all(companiesQuery, companiesParams, (err, companies) => {
      if (err) {
        return res.status(500).json({ error: 'Database error fetching companies' });
      }

      // Create initial token (without company selected)
      const tokenPayload = {
        userId: user.id,
        username: user.username,
        userType: userType,
        accountingFirmId: user.accounting_firm_id || null,
        companyId: null,
        role: null
      };

      // If user has exactly one company, auto-select it
      let selectedCompany = null;
      if (companies && companies.length === 1) {
        selectedCompany = companies[0];
        tokenPayload.companyId = selectedCompany.id;
        tokenPayload.role = selectedCompany.role;
      }

      const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '8h' });

      res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          fullName: user.full_name,
          email: user.email,
          userType: userType,
          accountingFirmId: user.accounting_firm_id
        },
        companies: companies || [],
        selectedCompany: selectedCompany,
        requiresCompanySelection: companies && companies.length > 1
      });
    });
  });
});

/**
 * GET /api/auth/companies
 * Get list of companies accessible to the authenticated user
 */
router.get('/companies', authenticateToken, (req, res) => {
  const userId = req.user.userId;
  const userType = req.user.userType;
  const firmId = req.user.accountingFirmId;

  let query;
  let params;

  if (userType === 'accountant' && firmId) {
    query = `
      SELECT c.id, c.company_name, c.trading_name, c.vat_number, 'accountant' as role
      FROM companies c
      JOIN firm_company_access fca ON c.id = fca.company_id
      WHERE fca.firm_id = ? AND fca.is_active = 1 AND c.is_active = 1
      ORDER BY c.company_name
    `;
    params = [firmId];
  } else {
    query = `
      SELECT c.id, c.company_name, c.trading_name, c.vat_number, uca.role, uca.is_primary
      FROM companies c
      JOIN user_company_access uca ON c.id = uca.company_id
      WHERE uca.user_id = ? AND uca.is_active = 1 AND c.is_active = 1
      ORDER BY uca.is_primary DESC, c.company_name ASC
    `;
    params = [userId];
  }

  db.all(query, params, (err, companies) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ companies: companies || [] });
  });
});

/**
 * POST /api/auth/select-company
 * Select a company to work with, returns new token with company context
 */
router.post('/select-company', authenticateToken, (req, res) => {
  const { companyId } = req.body;
  const userId = req.user.userId;
  const userType = req.user.userType;
  const firmId = req.user.accountingFirmId;

  if (!companyId) {
    return res.status(400).json({ error: 'Company ID is required' });
  }

  // Verify user has access to this company
  let verifyQuery;
  let verifyParams;

  if (userType === 'accountant' && firmId) {
    verifyQuery = `
      SELECT c.*, 'accountant' as role
      FROM companies c
      JOIN firm_company_access fca ON c.id = fca.company_id
      WHERE c.id = ? AND fca.firm_id = ? AND fca.is_active = 1 AND c.is_active = 1
    `;
    verifyParams = [companyId, firmId];
  } else {
    verifyQuery = `
      SELECT c.*, uca.role
      FROM companies c
      JOIN user_company_access uca ON c.id = uca.company_id
      WHERE c.id = ? AND uca.user_id = ? AND uca.is_active = 1 AND c.is_active = 1
    `;
    verifyParams = [companyId, userId];
  }

  db.get(verifyQuery, verifyParams, (err, company) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!company) {
      return res.status(403).json({ error: 'Access denied to this company' });
    }

    // Get user details for the new token
    db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
      if (err || !user) {
        return res.status(500).json({ error: 'Database error' });
      }

      // Create new token with company context
      const token = jwt.sign({
        userId: user.id,
        username: user.username,
        userType: userType,
        accountingFirmId: firmId,
        companyId: company.id,
        role: company.role
      }, JWT_SECRET, { expiresIn: '8h' });

      // Get permissions for this role
      const permissions = getRolePermissions(company.role);

      res.json({
        token,
        company: {
          id: company.id,
          name: company.company_name,
          tradingName: company.trading_name,
          vatNumber: company.vat_number
        },
        role: company.role,
        permissions: permissions
      });
    });
  });
});

/**
 * POST /api/auth/register
 * Register a new user (via invitation or self-registration for business owners)
 */
router.post('/register', async (req, res) => {
  const { username, email, password, fullName, invitationToken } = req.body;

  if (!username || !password || !fullName) {
    return res.status(400).json({ error: 'Username, password, and full name are required' });
  }

  // Check if username exists
  db.get('SELECT id FROM users WHERE username = ?', [username], async (err, existingUser) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // If invitation token provided, process it
    if (invitationToken) {
      db.get(
        'SELECT * FROM invitations WHERE token = ? AND is_used = 0 AND expires_at > CURRENT_TIMESTAMP',
        [invitationToken],
        (err, invitation) => {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }

          if (!invitation) {
            return res.status(400).json({ error: 'Invalid or expired invitation' });
          }

          // Create user with invitation context
          const userType = invitation.invitation_type === 'accountant' ? 'accountant' : 'company_user';
          const role = invitation.invitation_type;

          db.run(
            `INSERT INTO users (username, email, password_hash, full_name, role, user_type)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [username, email || invitation.email, passwordHash, fullName, role, userType],
            function(err) {
              if (err) {
                return res.status(500).json({ error: 'Failed to create user' });
              }

              const newUserId = this.lastID;

              // Link user to company
              db.run(
                `INSERT INTO user_company_access (user_id, company_id, role, is_primary)
                 VALUES (?, ?, ?, 1)`,
                [newUserId, invitation.company_id, role],
                (err) => {
                  if (err) {
                    return res.status(500).json({ error: 'Failed to link user to company' });
                  }

                  // Mark invitation as used
                  db.run(
                    `UPDATE invitations SET is_used = 1, accepted_at = CURRENT_TIMESTAMP, accepted_by_user_id = ?
                     WHERE id = ?`,
                    [newUserId, invitation.id],
                    (err) => {
                      if (err) {
                        console.error('Failed to update invitation:', err);
                      }

                      res.json({
                        success: true,
                        message: 'Account created successfully',
                        userId: newUserId
                      });
                    }
                  );
                }
              );
            }
          );
        }
      );
    } else {
      // Self-registration as business owner (creates new company)
      db.run(
        `INSERT INTO users (username, email, password_hash, full_name, role, user_type)
         VALUES (?, ?, ?, ?, 'business_owner', 'business_owner')`,
        [username, email, passwordHash, fullName],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Failed to create user' });
          }

          const newUserId = this.lastID;

          // Create a default company for this business owner
          const companyName = fullName + "'s Business";

          db.run(
            `INSERT INTO companies (company_name, trading_name)
             VALUES (?, ?)`,
            [companyName, companyName],
            function(err) {
              if (err) {
                return res.status(500).json({ error: 'Failed to create company' });
              }

              const newCompanyId = this.lastID;

              // Link user to company as business owner
              db.run(
                `INSERT INTO user_company_access (user_id, company_id, role, is_primary)
                 VALUES (?, ?, 'business_owner', 1)`,
                [newUserId, newCompanyId],
                (err) => {
                  if (err) {
                    return res.status(500).json({ error: 'Failed to link user to company' });
                  }

                  res.json({
                    success: true,
                    message: 'Account and company created successfully',
                    userId: newUserId,
                    companyId: newCompanyId
                  });
                }
              );
            }
          );
        }
      );
    }
  });
});

/**
 * POST /api/auth/invite
 * Create an invitation for a new user (accountant, admin, or cashier)
 */
router.post('/invite', authenticateToken, (req, res) => {
  const { email, role, companyId } = req.body;
  const invitedBy = req.user.userId;
  const userRole = req.user.role;

  // Only business owners can invite users
  if (userRole !== 'business_owner') {
    return res.status(403).json({ error: 'Only business owners can invite users' });
  }

  if (!email || !role) {
    return res.status(400).json({ error: 'Email and role are required' });
  }

  const validRoles = ['accountant', 'admin', 'cashier'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Must be accountant, admin, or cashier' });
  }

  const targetCompanyId = companyId || req.user.companyId;

  // Verify user owns this company
  db.get(
    'SELECT * FROM user_company_access WHERE user_id = ? AND company_id = ? AND role = ?',
    [invitedBy, targetCompanyId, 'business_owner'],
    (err, access) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!access) {
        return res.status(403).json({ error: 'You do not own this company' });
      }

      // Generate unique token
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      db.run(
        `INSERT INTO invitations (email, company_id, invitation_type, token, invited_by_user_id, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [email, targetCompanyId, role, token, invitedBy, expiresAt.toISOString()],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Failed to create invitation' });
          }

          // Get company name for the invite link
          db.get('SELECT company_name FROM companies WHERE id = ?', [targetCompanyId], (err, company) => {
            const inviteUrl = `${process.env.APP_URL || 'https://checkoutcharlie.zeabur.app'}/invite/${token}`;

            res.json({
              success: true,
              message: `Invitation created for ${email}`,
              inviteUrl: inviteUrl,
              token: token,
              expiresAt: expiresAt,
              companyName: company ? company.company_name : 'Unknown'
            });

            // TODO: Send email with inviteUrl (requires email service integration)
            console.log(`Invitation created: ${inviteUrl}`);
          });
        }
      );
    }
  );
});

/**
 * GET /api/auth/invite/:token
 * Validate an invitation token
 */
router.get('/invite/:token', (req, res) => {
  const { token } = req.params;

  db.get(
    `SELECT i.*, c.company_name, u.full_name as invited_by_name
     FROM invitations i
     JOIN companies c ON i.company_id = c.id
     LEFT JOIN users u ON i.invited_by_user_id = u.id
     WHERE i.token = ? AND i.is_used = 0 AND i.expires_at > CURRENT_TIMESTAMP`,
    [token],
    (err, invitation) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!invitation) {
        return res.status(404).json({ error: 'Invalid or expired invitation' });
      }

      res.json({
        valid: true,
        email: invitation.email,
        role: invitation.invitation_type,
        companyName: invitation.company_name,
        invitedBy: invitation.invited_by_name
      });
    }
  );
});

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', authenticateToken, (req, res) => {
  const userId = req.user.userId;

  db.get('SELECT id, username, email, full_name, user_type FROM users WHERE id = ?', [userId], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.full_name,
        userType: user.user_type
      },
      currentCompany: req.user.companyId ? {
        id: req.user.companyId,
        role: req.user.role
      } : null,
      permissions: req.user.role ? getRolePermissions(req.user.role) : null
    });
  });
});

/**
 * POST /api/auth/verify-manager
 * Verify manager credentials for authorization purposes
 * Used when cashiers need manager approval for actions like returns, price overrides
 */
router.post('/verify-manager', authenticateToken, async (req, res) => {
  const { username, password } = req.body;
  const companyId = req.user.companyId;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  // Get the user by username
  db.get('SELECT * FROM users WHERE username = ? AND is_active = 1', [username], async (err, manager) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!manager) {
      return res.status(401).json({ error: 'Invalid credentials', authorized: false });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, manager.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials', authorized: false });
    }

    // Check if user has manager/owner role in this company
    db.get(
      `SELECT role FROM user_company_access
       WHERE user_id = ? AND company_id = ? AND is_active = 1
       AND role IN ('business_owner', 'admin', 'accountant')`,
      [manager.id, companyId],
      (err, access) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }

        if (!access) {
          return res.status(403).json({
            error: 'User does not have manager permissions for this company',
            authorized: false
          });
        }

        // Success - user is authorized manager
        res.json({
          success: true,
          authorized: true,
          userId: manager.id,
          role: access.role,
          name: manager.full_name
        });
      }
    );
  });
});

/**
 * POST /api/auth/change-password
 * Change current user's password
 */
router.post('/change-password', authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.userId;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  db.get('SELECT * FROM users WHERE id = ?', [userId], async (err, user) => {
    if (err || !user) {
      return res.status(500).json({ error: 'Database error' });
    }

    const validPassword = await bcrypt.compare(currentPassword, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);

    db.run('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userId], (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to update password' });
      }

      res.json({ success: true, message: 'Password changed successfully' });
    });
  });
});

// ========== COMPANY MANAGEMENT ==========

/**
 * GET /api/auth/companies/all
 * Get all companies (for corporate admin / business owner)
 */
router.get('/companies/all', authenticateToken, (req, res) => {
  const userId = req.user.userId;
  const userRole = req.user.role;

  // Only business_owner and corporate_admin can see all companies
  if (!['business_owner', 'corporate_admin'].includes(userRole)) {
    return res.status(403).json({ error: 'Only business owners and corporate admins can manage companies' });
  }

  db.all(
    `SELECT c.*,
       (SELECT COUNT(*) FROM user_company_access uca WHERE uca.company_id = c.id AND uca.is_active = 1) as user_count
     FROM companies c
     ORDER BY c.created_at DESC`,
    [],
    (err, companies) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ companies: companies || [] });
    }
  );
});

/**
 * POST /api/auth/companies/create
 * Create a new company (separate tenant)
 */
router.post('/companies/create', authenticateToken, (req, res) => {
  const userRole = req.user.role;
  const userId = req.user.userId;

  if (!['business_owner', 'corporate_admin'].includes(userRole)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const { company_name, trading_name, registration_number, vat_number, contact_email, contact_phone, address } = req.body;

  if (!company_name) {
    return res.status(400).json({ error: 'Company name is required' });
  }

  db.run(
    `INSERT INTO companies (company_name, trading_name, registration_number, vat_number, contact_email, contact_phone, address)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [company_name, trading_name || null, registration_number || null, vat_number || null, contact_email || null, contact_phone || null, address || null],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to create company', details: err.message });

      const newCompanyId = this.lastID;

      // Link the creator as business_owner of the new company
      db.run(
        `INSERT INTO user_company_access (user_id, company_id, role, is_primary, granted_by_user_id)
         VALUES (?, ?, 'business_owner', 0, ?)`,
        [userId, newCompanyId, userId],
        function(err2) {
          if (err2) console.error('Failed to link creator to company:', err2);

          // Create default location for new company
          db.run(
            `INSERT INTO locations (company_id, location_code, location_name, location_type)
             VALUES (?, 'HQ-001', 'Head Office', 'hq')`,
            [newCompanyId],
            function(err3) {
              if (err3) console.error('Failed to create default location:', err3);

              // Create default settings
              db.run(
                `INSERT INTO company_settings (company_id, till_float_amount) VALUES (?, 500.00)`,
                [newCompanyId],
                function(err4) {
                  if (err4) console.error('Failed to create company settings:', err4);

                  res.status(201).json({
                    message: 'Company created successfully',
                    company: { id: newCompanyId, company_name, trading_name }
                  });
                }
              );
            }
          );
        }
      );
    }
  );
});

/**
 * PUT /api/auth/companies/:id
 * Update company details
 */
router.put('/companies/:id', authenticateToken, (req, res) => {
  const userRole = req.user.role;
  if (!['business_owner', 'corporate_admin'].includes(userRole)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const companyId = req.params.id;
  const { company_name, trading_name, registration_number, vat_number, contact_email, contact_phone, address } = req.body;

  db.run(
    `UPDATE companies SET
      company_name = COALESCE(?, company_name),
      trading_name = COALESCE(?, trading_name),
      registration_number = COALESCE(?, registration_number),
      vat_number = COALESCE(?, vat_number),
      contact_email = COALESCE(?, contact_email),
      contact_phone = COALESCE(?, contact_phone),
      address = COALESCE(?, address),
      updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [company_name, trading_name, registration_number, vat_number, contact_email, contact_phone, address, companyId],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to update company' });
      if (this.changes === 0) return res.status(404).json({ error: 'Company not found' });
      res.json({ message: 'Company updated' });
    }
  );
});

/**
 * GET /api/auth/companies/:id/users
 * Get all users for a specific company
 */
router.get('/companies/:id/users', authenticateToken, (req, res) => {
  const userRole = req.user.role;
  if (!['business_owner', 'corporate_admin', 'store_manager', 'admin'].includes(userRole)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  db.all(
    `SELECT u.id, u.username, u.email, u.full_name, u.employee_id, u.is_active,
            u.last_login_at, u.created_at, u.employment_status,
            uca.role, uca.is_primary
     FROM user_company_access uca
     JOIN users u ON uca.user_id = u.id
     WHERE uca.company_id = ? AND uca.is_active = 1
     ORDER BY u.full_name ASC`,
    [req.params.id],
    (err, users) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ users: users || [] });
    }
  );
});

/**
 * POST /api/auth/companies/:id/users
 * Add a new user directly to a company (no invitation needed)
 */
router.post('/companies/:id/users', authenticateToken, async (req, res) => {
  const userRole = req.user.role;
  if (!['business_owner', 'corporate_admin', 'store_manager', 'admin'].includes(userRole)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const companyId = req.params.id;
  const { username, email, password, full_name, role, employee_id, department, location_id } = req.body;

  if (!username || !password || !full_name || !role) {
    return res.status(400).json({ error: 'Username, password, full name, and role are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  // Check username uniqueness
  db.get('SELECT id FROM users WHERE username = ?', [username], async (err, existing) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    const passwordHash = await bcrypt.hash(password, 10);

    db.run(
      `INSERT INTO users (username, email, password_hash, full_name, role, user_type, employee_id, is_active)
       VALUES (?, ?, ?, ?, ?, 'company_user', ?, 1)`,
      [username, email || null, passwordHash, full_name, role, employee_id || null],
      function(err2) {
        if (err2) return res.status(500).json({ error: 'Failed to create user', details: err2.message });

        const newUserId = this.lastID;

        // Link user to company
        db.run(
          `INSERT INTO user_company_access (user_id, company_id, role, is_primary, granted_by_user_id)
           VALUES (?, ?, ?, 1, ?)`,
          [newUserId, companyId, role, req.user.userId],
          function(err3) {
            if (err3) return res.status(500).json({ error: 'Failed to link user to company' });

            // Optionally assign to location
            if (location_id) {
              db.run(
                `INSERT INTO user_location_access (user_id, location_id, role, is_primary, granted_by_user_id)
                 VALUES (?, ?, ?, 1, ?)`,
                [newUserId, location_id, role, req.user.userId],
                (err4) => { if (err4) console.error('Failed to assign location:', err4); }
              );
            }

            res.status(201).json({
              message: 'User created and added to company',
              user: { id: newUserId, username, full_name, role }
            });
          }
        );
      }
    );
  });
});

/**
 * DELETE /api/auth/companies/:companyId/users/:userId
 * Remove a user from a company
 */
router.delete('/companies/:companyId/users/:userId', authenticateToken, (req, res) => {
  const userRole = req.user.role;
  if (!['business_owner', 'corporate_admin'].includes(userRole)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  db.run(
    `UPDATE user_company_access SET is_active = 0 WHERE user_id = ? AND company_id = ?`,
    [req.params.userId, req.params.companyId],
    function(err) {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (this.changes === 0) return res.status(404).json({ error: 'User not found in this company' });
      res.json({ message: 'User removed from company' });
    }
  );
});

module.exports = router;
