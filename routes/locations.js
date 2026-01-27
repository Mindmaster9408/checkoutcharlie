/**
 * ============================================================================
 * Location Routes - Enterprise Multi-Location POS System
 * ============================================================================
 * Handles location hierarchy, settings, and user assignments.
 * Location Types: hq, region, district, store, warehouse
 * ============================================================================
 */

const express = require('express');
const db = require('../database');
const { authenticateToken, requireCompany, requirePermission } = require('../middleware/auth');

const router = express.Router();

// All routes require authentication and company context
router.use(authenticateToken);
router.use(requireCompany);

/**
 * GET /api/locations
 * Get all locations for the company (filtered by user access)
 */
router.get('/', (req, res) => {
  const companyId = req.user.companyId;
  const userRole = req.user.role;
  const userId = req.user.userId;
  const { type, active_only, parent_id } = req.query;

  let query = `
    SELECT l.*,
           u.full_name as manager_name,
           (SELECT COUNT(*) FROM locations cl WHERE cl.parent_location_id = l.id) as child_count,
           (SELECT COUNT(*) FROM user_location_access ula WHERE ula.location_id = l.id AND ula.is_active = 1) as user_count
    FROM locations l
    LEFT JOIN users u ON l.manager_user_id = u.id
    WHERE l.company_id = ?
  `;
  const params = [companyId];

  if (active_only !== 'false') {
    query += ' AND l.is_active = 1';
  }

  if (type) {
    query += ' AND l.location_type = ?';
    params.push(type);
  }

  if (parent_id) {
    if (parent_id === 'null' || parent_id === 'root') {
      query += ' AND l.parent_location_id IS NULL';
    } else {
      query += ' AND l.parent_location_id = ?';
      params.push(parent_id);
    }
  }

  // Non-corporate users only see their assigned locations and children
  if (!['corporate_admin', 'corporate_finance', 'corporate_ops', 'business_owner', 'accountant'].includes(userRole)) {
    query = `
      SELECT l.*,
             u.full_name as manager_name,
             (SELECT COUNT(*) FROM locations cl WHERE cl.parent_location_id = l.id) as child_count,
             (SELECT COUNT(*) FROM user_location_access ula WHERE ula.location_id = l.id AND ula.is_active = 1) as user_count
      FROM locations l
      LEFT JOIN users u ON l.manager_user_id = u.id
      WHERE l.company_id = ?
        AND l.is_active = 1
        AND l.id IN (
          SELECT location_id FROM user_location_access WHERE user_id = ? AND is_active = 1
          UNION
          SELECT l2.id FROM locations l2
          JOIN user_location_access ula ON l2.parent_location_id = ula.location_id
          WHERE ula.user_id = ? AND ula.can_manage_children = 1 AND ula.is_active = 1
        )
      ORDER BY l.location_type, l.location_name
    `;
    params.length = 0;
    params.push(companyId, userId, userId);
  } else {
    query += ' ORDER BY l.location_type, l.location_name';
  }

  db.all(query, params, (err, locations) => {
    if (err) {
      console.error('Error fetching locations:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ locations });
  });
});

/**
 * GET /api/locations/tree
 * Get full location hierarchy as a tree structure
 */
router.get('/tree', (req, res) => {
  const companyId = req.user.companyId;

  db.all(
    `SELECT l.*, u.full_name as manager_name
     FROM locations l
     LEFT JOIN users u ON l.manager_user_id = u.id
     WHERE l.company_id = ? AND l.is_active = 1
     ORDER BY l.location_type, l.location_name`,
    [companyId],
    (err, locations) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      // Build tree structure
      const locationMap = {};
      const tree = [];

      // First pass: create map
      locations.forEach(loc => {
        locationMap[loc.id] = { ...loc, children: [] };
      });

      // Second pass: build tree
      locations.forEach(loc => {
        if (loc.parent_location_id && locationMap[loc.parent_location_id]) {
          locationMap[loc.parent_location_id].children.push(locationMap[loc.id]);
        } else {
          tree.push(locationMap[loc.id]);
        }
      });

      res.json({ tree });
    }
  );
});

/**
 * GET /api/locations/:id
 * Get single location details
 */
router.get('/:id', (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  db.get(
    `SELECT l.*,
            u.full_name as manager_name,
            p.location_name as parent_name,
            p.location_type as parent_type
     FROM locations l
     LEFT JOIN users u ON l.manager_user_id = u.id
     LEFT JOIN locations p ON l.parent_location_id = p.id
     WHERE l.id = ? AND l.company_id = ?`,
    [id, companyId],
    (err, location) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (!location) {
        return res.status(404).json({ error: 'Location not found' });
      }
      res.json({ location });
    }
  );
});

/**
 * GET /api/locations/:id/hierarchy
 * Get location with full ancestry and children
 */
router.get('/:id/hierarchy', (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  // Get the location
  db.get(
    'SELECT * FROM locations WHERE id = ? AND company_id = ?',
    [id, companyId],
    (err, location) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (!location) {
        return res.status(404).json({ error: 'Location not found' });
      }

      // Get ancestors (path to root)
      const getAncestors = (locId, ancestors = []) => {
        return new Promise((resolve) => {
          db.get(
            'SELECT * FROM locations WHERE id = ?',
            [locId],
            (err, loc) => {
              if (err || !loc || !loc.parent_location_id) {
                resolve(ancestors);
              } else {
                db.get(
                  'SELECT * FROM locations WHERE id = ?',
                  [loc.parent_location_id],
                  (err, parent) => {
                    if (parent) {
                      ancestors.unshift(parent);
                      getAncestors(parent.id, ancestors).then(resolve);
                    } else {
                      resolve(ancestors);
                    }
                  }
                );
              }
            }
          );
        });
      };

      // Get children
      db.all(
        'SELECT * FROM locations WHERE parent_location_id = ? AND is_active = 1 ORDER BY location_name',
        [id],
        async (err, children) => {
          const ancestors = await getAncestors(id);
          res.json({
            location,
            ancestors,
            children: children || []
          });
        }
      );
    }
  );
});

/**
 * POST /api/locations
 * Create a new location
 */
router.post('/', requirePermission('SETTINGS.COMPANY'), (req, res) => {
  const companyId = req.user.companyId;
  const userId = req.user.userId;
  const {
    location_code,
    location_name,
    location_type,
    parent_location_id,
    address_line_1,
    address_line_2,
    city,
    state_province,
    postal_code,
    country,
    timezone,
    square_footage,
    manager_user_id,
    contact_phone,
    contact_email,
    operating_hours
  } = req.body;

  if (!location_code || !location_name || !location_type) {
    return res.status(400).json({ error: 'Location code, name, and type are required' });
  }

  // Validate location type
  const validTypes = ['hq', 'region', 'district', 'store', 'warehouse'];
  if (!validTypes.includes(location_type)) {
    return res.status(400).json({ error: 'Invalid location type. Must be: hq, region, district, store, or warehouse' });
  }

  // Check for duplicate code
  db.get(
    'SELECT id FROM locations WHERE company_id = ? AND location_code = ?',
    [companyId, location_code],
    (err, existing) => {
      if (existing) {
        return res.status(400).json({ error: 'Location code already exists' });
      }

      db.run(
        `INSERT INTO locations (
          company_id, location_code, location_name, location_type, parent_location_id,
          address_line_1, address_line_2, city, state_province, postal_code,
          country, timezone, square_footage, manager_user_id, contact_phone,
          contact_email, operating_hours
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          companyId, location_code, location_name, location_type, parent_location_id || null,
          address_line_1, address_line_2, city, state_province, postal_code,
          country || 'South Africa', timezone || 'Africa/Johannesburg', square_footage,
          manager_user_id, contact_phone, contact_email,
          operating_hours ? JSON.stringify(operating_hours) : null
        ],
        function(err) {
          if (err) {
            console.error('Error creating location:', err);
            return res.status(500).json({ error: 'Failed to create location' });
          }

          // Log audit
          db.run(
            `INSERT INTO audit_trail (company_id, user_id, event_type, event_category, event_data)
             VALUES (?, ?, ?, ?, ?)`,
            [companyId, userId, 'location_created', 'settings', JSON.stringify({ location_id: this.lastID, location_code, location_name })]
          );

          res.status(201).json({
            success: true,
            location_id: this.lastID,
            message: 'Location created successfully'
          });
        }
      );
    }
  );
});

/**
 * PUT /api/locations/:id
 * Update a location
 */
router.put('/:id', requirePermission('SETTINGS.COMPANY'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const userId = req.user.userId;
  const {
    location_name,
    location_type,
    parent_location_id,
    address_line_1,
    address_line_2,
    city,
    state_province,
    postal_code,
    country,
    timezone,
    square_footage,
    manager_user_id,
    contact_phone,
    contact_email,
    operating_hours,
    is_active
  } = req.body;

  db.get('SELECT * FROM locations WHERE id = ? AND company_id = ?', [id, companyId], (err, location) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    // Prevent circular parent reference
    if (parent_location_id && parseInt(parent_location_id) === parseInt(id)) {
      return res.status(400).json({ error: 'Location cannot be its own parent' });
    }

    db.run(
      `UPDATE locations SET
        location_name = COALESCE(?, location_name),
        location_type = COALESCE(?, location_type),
        parent_location_id = ?,
        address_line_1 = COALESCE(?, address_line_1),
        address_line_2 = ?,
        city = COALESCE(?, city),
        state_province = ?,
        postal_code = ?,
        country = COALESCE(?, country),
        timezone = COALESCE(?, timezone),
        square_footage = ?,
        manager_user_id = ?,
        contact_phone = ?,
        contact_email = ?,
        operating_hours = ?,
        is_active = COALESCE(?, is_active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND company_id = ?`,
      [
        location_name, location_type, parent_location_id,
        address_line_1, address_line_2, city, state_province, postal_code,
        country, timezone, square_footage, manager_user_id,
        contact_phone, contact_email,
        operating_hours ? JSON.stringify(operating_hours) : location.operating_hours,
        is_active, id, companyId
      ],
      (err) => {
        if (err) {
          console.error('Error updating location:', err);
          return res.status(500).json({ error: 'Failed to update location' });
        }

        // Log audit
        db.run(
          `INSERT INTO audit_trail (company_id, user_id, event_type, event_category, event_data)
           VALUES (?, ?, ?, ?, ?)`,
          [companyId, userId, 'location_updated', 'settings', JSON.stringify({ location_id: id })]
        );

        res.json({ success: true, message: 'Location updated successfully' });
      }
    );
  });
});

/**
 * DELETE /api/locations/:id
 * Soft delete a location
 */
router.delete('/:id', requirePermission('SETTINGS.COMPANY'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const userId = req.user.userId;

  // Check for child locations
  db.get('SELECT COUNT(*) as count FROM locations WHERE parent_location_id = ? AND is_active = 1', [id], (err, result) => {
    if (result && result.count > 0) {
      return res.status(400).json({ error: 'Cannot delete location with active child locations. Reassign or delete children first.' });
    }

    db.run(
      'UPDATE locations SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?',
      [id, companyId],
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to delete location' });
        }

        // Log audit
        db.run(
          `INSERT INTO audit_trail (company_id, user_id, event_type, event_category, event_data)
           VALUES (?, ?, ?, ?, ?)`,
          [companyId, userId, 'location_deleted', 'settings', JSON.stringify({ location_id: id })]
        );

        res.json({ success: true, message: 'Location deleted successfully' });
      }
    );
  });
});

/**
 * GET /api/locations/:id/settings
 * Get effective settings for a location (with inheritance)
 */
router.get('/:id/settings', (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  // Get location and its ancestors
  db.get('SELECT * FROM locations WHERE id = ? AND company_id = ?', [id, companyId], async (err, location) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    // Build ancestor chain
    const ancestors = [];
    let currentId = location.parent_location_id;
    while (currentId) {
      const parent = await new Promise((resolve) => {
        db.get('SELECT * FROM locations WHERE id = ?', [currentId], (err, p) => resolve(p));
      });
      if (parent) {
        ancestors.unshift(parent.id);
        currentId = parent.parent_location_id;
      } else {
        break;
      }
    }
    ancestors.push(parseInt(id));

    // Get all settings for this location chain
    const placeholders = ancestors.map(() => '?').join(',');
    db.all(
      `SELECT * FROM location_settings WHERE location_id IN (${placeholders}) ORDER BY location_id`,
      ancestors,
      (err, allSettings) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }

        // Build effective settings (later overrides earlier)
        const effectiveSettings = {};
        const settingSources = {};

        ancestors.forEach(locId => {
          const locSettings = allSettings.filter(s => s.location_id === locId);
          locSettings.forEach(s => {
            if (!effectiveSettings[s.setting_key] || !s.inherit_from_parent) {
              effectiveSettings[s.setting_key] = s.setting_value;
              settingSources[s.setting_key] = locId;
            }
          });
        });

        res.json({
          location_id: id,
          settings: effectiveSettings,
          sources: settingSources,
          raw_settings: allSettings.filter(s => s.location_id === parseInt(id))
        });
      }
    );
  });
});

/**
 * PUT /api/locations/:id/settings
 * Update settings for a location
 */
router.put('/:id/settings', requirePermission('SETTINGS.COMPANY'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const userId = req.user.userId;
  const { settings } = req.body; // { key: value, key2: value2, ... }

  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: 'Settings object required' });
  }

  db.get('SELECT id FROM locations WHERE id = ? AND company_id = ?', [id, companyId], (err, location) => {
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    const settingEntries = Object.entries(settings);
    let completed = 0;

    settingEntries.forEach(([key, value]) => {
      db.run(
        `INSERT INTO location_settings (location_id, setting_key, setting_value, inherit_from_parent, updated_by_user_id)
         VALUES (?, ?, ?, 0, ?)
         ON CONFLICT(location_id, setting_key) DO UPDATE SET
           setting_value = excluded.setting_value,
           inherit_from_parent = 0,
           updated_by_user_id = excluded.updated_by_user_id,
           updated_at = CURRENT_TIMESTAMP`,
        [id, key, value, userId],
        () => {
          completed++;
          if (completed === settingEntries.length) {
            res.json({ success: true, message: 'Settings updated' });
          }
        }
      );
    });

    if (settingEntries.length === 0) {
      res.json({ success: true, message: 'No settings to update' });
    }
  });
});

/**
 * GET /api/locations/:id/users
 * Get users assigned to a location
 */
router.get('/:id/users', (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  db.all(
    `SELECT u.id, u.username, u.full_name, u.email, u.employee_id,
            ula.role, ula.is_primary, ula.can_manage_children, ula.granted_at
     FROM users u
     JOIN user_location_access ula ON u.id = ula.user_id
     WHERE ula.location_id = ? AND ula.is_active = 1 AND u.is_active = 1
     ORDER BY ula.role, u.full_name`,
    [id],
    (err, users) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ users });
    }
  );
});

/**
 * POST /api/locations/:id/users
 * Assign user to location
 */
router.post('/:id/users', requirePermission('SETTINGS.USERS'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const grantedBy = req.user.userId;
  const { user_id, role, is_primary, can_manage_children } = req.body;

  if (!user_id || !role) {
    return res.status(400).json({ error: 'User ID and role are required' });
  }

  // Verify location exists
  db.get('SELECT id FROM locations WHERE id = ? AND company_id = ?', [id, companyId], (err, location) => {
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    // If setting as primary, unset other primaries for this user
    const setPrimary = () => {
      if (is_primary) {
        db.run(
          'UPDATE user_location_access SET is_primary = 0 WHERE user_id = ?',
          [user_id],
          () => insertAccess()
        );
      } else {
        insertAccess();
      }
    };

    const insertAccess = () => {
      db.run(
        `INSERT INTO user_location_access (user_id, location_id, role, is_primary, can_manage_children, granted_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, location_id) DO UPDATE SET
           role = excluded.role,
           is_primary = excluded.is_primary,
           can_manage_children = excluded.can_manage_children,
           is_active = 1`,
        [user_id, id, role, is_primary ? 1 : 0, can_manage_children ? 1 : 0, grantedBy],
        (err) => {
          if (err) {
            console.error('Error assigning user:', err);
            return res.status(500).json({ error: 'Failed to assign user' });
          }

          // Log audit
          db.run(
            `INSERT INTO audit_trail (company_id, user_id, event_type, event_category, event_data)
             VALUES (?, ?, ?, ?, ?)`,
            [companyId, grantedBy, 'user_assigned_location', 'settings', JSON.stringify({ user_id, location_id: id, role })]
          );

          res.json({ success: true, message: 'User assigned to location' });
        }
      );
    };

    setPrimary();
  });
});

/**
 * DELETE /api/locations/:id/users/:userId
 * Remove user from location
 */
router.delete('/:id/users/:userId', requirePermission('SETTINGS.USERS'), (req, res) => {
  const { id, userId } = req.params;
  const companyId = req.user.companyId;
  const removedBy = req.user.userId;

  db.run(
    'UPDATE user_location_access SET is_active = 0 WHERE location_id = ? AND user_id = ?',
    [id, userId],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to remove user' });
      }

      // Log audit
      db.run(
        `INSERT INTO audit_trail (company_id, user_id, event_type, event_category, event_data)
         VALUES (?, ?, ?, ?, ?)`,
        [companyId, removedBy, 'user_removed_location', 'settings', JSON.stringify({ user_id: userId, location_id: id })]
      );

      res.json({ success: true, message: 'User removed from location' });
    }
  );
});

/**
 * GET /api/locations/:id/performance
 * Get performance metrics for a location
 */
router.get('/:id/performance', (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const { start_date, end_date } = req.query;

  const startDate = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const endDate = end_date || new Date().toISOString().split('T')[0];

  // Get aggregated metrics
  db.get(
    `SELECT
       COUNT(*) as total_transactions,
       COALESCE(SUM(total_amount), 0) as total_sales,
       COALESCE(AVG(total_amount), 0) as avg_transaction,
       COUNT(DISTINCT customer_id) as unique_customers,
       COUNT(DISTINCT DATE(created_at)) as active_days
     FROM sales
     WHERE location_id = ? AND company_id = ?
       AND DATE(created_at) BETWEEN ? AND ?
       AND status = 'completed'`,
    [id, companyId, startDate, endDate],
    (err, metrics) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      // Get daily breakdown
      db.all(
        `SELECT
           DATE(created_at) as date,
           COUNT(*) as transactions,
           SUM(total_amount) as sales
         FROM sales
         WHERE location_id = ? AND company_id = ?
           AND DATE(created_at) BETWEEN ? AND ?
           AND status = 'completed'
         GROUP BY DATE(created_at)
         ORDER BY date`,
        [id, companyId, startDate, endDate],
        (err, daily) => {
          res.json({
            location_id: id,
            period: { start_date: startDate, end_date: endDate },
            summary: metrics,
            daily: daily || []
          });
        }
      );
    }
  );
});

module.exports = router;
