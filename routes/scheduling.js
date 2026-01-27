/**
 * ============================================================================
 * Scheduling Routes - Shift Management & Time Tracking
 * ============================================================================
 */

const express = require('express');
const db = require('../database');
const { authenticateToken, requireCompany, requirePermission } = require('../middleware/auth');

const router = express.Router();

router.use(authenticateToken);
router.use(requireCompany);

// ========== SHIFT SCHEDULES ==========

/**
 * GET /api/scheduling/shifts
 * Get shift schedules
 */
router.get('/shifts', (req, res) => {
  const companyId = req.user.companyId;
  const userId = req.user.userId;
  const userRole = req.user.role;
  const { location_id, user_id, start_date, end_date, status } = req.query;

  let query = `
    SELECT ss.*, u.full_name, u.employee_id, l.location_name
    FROM shift_schedules ss
    JOIN users u ON ss.user_id = u.id
    JOIN locations l ON ss.location_id = l.id
    WHERE ss.company_id = ?
  `;
  const params = [companyId];

  // Non-managers only see their own shifts
  if (!['corporate_admin', 'business_owner', 'regional_manager', 'district_manager', 'store_manager', 'admin'].includes(userRole)) {
    query += ' AND ss.user_id = ?';
    params.push(userId);
  } else if (user_id) {
    query += ' AND ss.user_id = ?';
    params.push(user_id);
  }

  if (location_id) {
    query += ' AND ss.location_id = ?';
    params.push(location_id);
  }

  if (start_date) {
    query += ' AND ss.shift_date >= ?';
    params.push(start_date);
  }

  if (end_date) {
    query += ' AND ss.shift_date <= ?';
    params.push(end_date);
  }

  if (status) {
    query += ' AND ss.status = ?';
    params.push(status);
  }

  query += ' ORDER BY ss.shift_date, ss.scheduled_start';

  db.all(query, params, (err, shifts) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ shifts });
  });
});

/**
 * GET /api/scheduling/shifts/my
 * Get current user's upcoming shifts
 */
router.get('/shifts/my', (req, res) => {
  const companyId = req.user.companyId;
  const userId = req.user.userId;

  db.all(
    `SELECT ss.*, l.location_name
     FROM shift_schedules ss
     JOIN locations l ON ss.location_id = l.id
     WHERE ss.company_id = ? AND ss.user_id = ?
       AND ss.shift_date >= DATE('now')
     ORDER BY ss.shift_date, ss.scheduled_start
     LIMIT 14`,
    [companyId, userId],
    (err, shifts) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ shifts });
    }
  );
});

/**
 * POST /api/scheduling/shifts
 * Create shift schedule
 */
router.post('/shifts', requirePermission('EMPLOYEES.MANAGE_SCHEDULE'), (req, res) => {
  const companyId = req.user.companyId;
  const createdBy = req.user.userId;
  const { user_id, location_id, shift_date, scheduled_start, scheduled_end, break_duration_minutes, notes } = req.body;

  if (!user_id || !location_id || !shift_date || !scheduled_start || !scheduled_end) {
    return res.status(400).json({ error: 'User, location, date, start and end times are required' });
  }

  db.run(
    `INSERT INTO shift_schedules (company_id, user_id, location_id, shift_date, scheduled_start, scheduled_end, break_duration_minutes, notes, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [companyId, user_id, location_id, shift_date, scheduled_start, scheduled_end, break_duration_minutes || 60, notes, createdBy],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to create shift' });
      res.status(201).json({ success: true, shift_id: this.lastID });
    }
  );
});

/**
 * POST /api/scheduling/shifts/bulk
 * Create multiple shifts
 */
router.post('/shifts/bulk', requirePermission('EMPLOYEES.MANAGE_SCHEDULE'), (req, res) => {
  const companyId = req.user.companyId;
  const createdBy = req.user.userId;
  const { shifts } = req.body;

  if (!shifts || !Array.isArray(shifts) || shifts.length === 0) {
    return res.status(400).json({ error: 'Shifts array required' });
  }

  let created = 0;
  shifts.forEach(shift => {
    db.run(
      `INSERT INTO shift_schedules (company_id, user_id, location_id, shift_date, scheduled_start, scheduled_end, break_duration_minutes, notes, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, shift.user_id, shift.location_id, shift.shift_date, shift.scheduled_start, shift.scheduled_end, shift.break_duration_minutes || 60, shift.notes, createdBy],
      () => {
        created++;
        if (created === shifts.length) {
          res.json({ success: true, created });
        }
      }
    );
  });
});

/**
 * PUT /api/scheduling/shifts/:id
 * Update shift
 */
router.put('/shifts/:id', requirePermission('EMPLOYEES.MANAGE_SCHEDULE'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const { scheduled_start, scheduled_end, break_duration_minutes, status, notes } = req.body;

  db.run(
    `UPDATE shift_schedules SET
      scheduled_start = COALESCE(?, scheduled_start),
      scheduled_end = COALESCE(?, scheduled_end),
      break_duration_minutes = COALESCE(?, break_duration_minutes),
      status = COALESCE(?, status),
      notes = COALESCE(?, notes)
     WHERE id = ? AND company_id = ?`,
    [scheduled_start, scheduled_end, break_duration_minutes, status, notes, id, companyId],
    (err) => {
      if (err) return res.status(500).json({ error: 'Failed to update shift' });
      res.json({ success: true });
    }
  );
});

/**
 * DELETE /api/scheduling/shifts/:id
 * Cancel shift
 */
router.delete('/shifts/:id', requirePermission('EMPLOYEES.MANAGE_SCHEDULE'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  db.run(
    `UPDATE shift_schedules SET status = 'cancelled' WHERE id = ? AND company_id = ?`,
    [id, companyId],
    (err) => {
      if (err) return res.status(500).json({ error: 'Failed to cancel shift' });
      res.json({ success: true });
    }
  );
});

// ========== TIME TRACKING ==========

/**
 * POST /api/scheduling/time/clock-in
 * Clock in
 */
router.post('/time/clock-in', requirePermission('EMPLOYEES.CLOCK_IN_OUT'), (req, res) => {
  const companyId = req.user.companyId;
  const userId = req.user.userId;
  const { location_id, shift_schedule_id } = req.body;

  // Check for existing open entry
  db.get(
    'SELECT id FROM time_entries WHERE user_id = ? AND clock_out IS NULL',
    [userId],
    (err, existing) => {
      if (existing) {
        return res.status(400).json({ error: 'Already clocked in. Please clock out first.' });
      }

      db.run(
        `INSERT INTO time_entries (company_id, user_id, location_id, shift_schedule_id, clock_in)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [companyId, userId, location_id, shift_schedule_id],
        function(err) {
          if (err) return res.status(500).json({ error: 'Failed to clock in' });

          // Update shift schedule if linked
          if (shift_schedule_id) {
            db.run(
              `UPDATE shift_schedules SET actual_start = CURRENT_TIMESTAMP, status = 'checked_in' WHERE id = ?`,
              [shift_schedule_id]
            );
          }

          res.json({ success: true, time_entry_id: this.lastID, clock_in: new Date().toISOString() });
        }
      );
    }
  );
});

/**
 * POST /api/scheduling/time/clock-out
 * Clock out
 */
router.post('/time/clock-out', requirePermission('EMPLOYEES.CLOCK_IN_OUT'), (req, res) => {
  const userId = req.user.userId;
  const { notes } = req.body;

  db.get(
    'SELECT * FROM time_entries WHERE user_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1',
    [userId],
    (err, entry) => {
      if (!entry) {
        return res.status(400).json({ error: 'No active clock-in found' });
      }

      const clockIn = new Date(entry.clock_in);
      const clockOut = new Date();
      let totalHours = (clockOut - clockIn) / (1000 * 60 * 60);

      // Subtract break time if taken
      if (entry.break_start && entry.break_end) {
        const breakTime = (new Date(entry.break_end) - new Date(entry.break_start)) / (1000 * 60 * 60);
        totalHours -= breakTime;
      }

      const overtimeHours = totalHours > 8 ? totalHours - 8 : 0;

      db.run(
        `UPDATE time_entries SET clock_out = CURRENT_TIMESTAMP, total_hours = ?, overtime_hours = ?, notes = ?
         WHERE id = ?`,
        [totalHours.toFixed(2), overtimeHours.toFixed(2), notes, entry.id],
        (err) => {
          if (err) return res.status(500).json({ error: 'Failed to clock out' });

          // Update shift schedule if linked
          if (entry.shift_schedule_id) {
            db.run(
              `UPDATE shift_schedules SET actual_end = CURRENT_TIMESTAMP, status = 'checked_out' WHERE id = ?`,
              [entry.shift_schedule_id]
            );
          }

          res.json({
            success: true,
            clock_out: clockOut.toISOString(),
            total_hours: totalHours.toFixed(2),
            overtime_hours: overtimeHours.toFixed(2)
          });
        }
      );
    }
  );
});

/**
 * POST /api/scheduling/time/break-start
 * Start break
 */
router.post('/time/break-start', requirePermission('EMPLOYEES.CLOCK_IN_OUT'), (req, res) => {
  const userId = req.user.userId;

  db.run(
    `UPDATE time_entries SET break_start = CURRENT_TIMESTAMP
     WHERE user_id = ? AND clock_out IS NULL AND break_start IS NULL`,
    [userId],
    function(err) {
      if (err || this.changes === 0) {
        return res.status(400).json({ error: 'No active shift or break already started' });
      }
      res.json({ success: true, break_start: new Date().toISOString() });
    }
  );
});

/**
 * POST /api/scheduling/time/break-end
 * End break
 */
router.post('/time/break-end', requirePermission('EMPLOYEES.CLOCK_IN_OUT'), (req, res) => {
  const userId = req.user.userId;

  db.run(
    `UPDATE time_entries SET break_end = CURRENT_TIMESTAMP
     WHERE user_id = ? AND clock_out IS NULL AND break_start IS NOT NULL AND break_end IS NULL`,
    [userId],
    function(err) {
      if (err || this.changes === 0) {
        return res.status(400).json({ error: 'No active break to end' });
      }
      res.json({ success: true, break_end: new Date().toISOString() });
    }
  );
});

/**
 * GET /api/scheduling/time/entries
 * Get time entries
 */
router.get('/time/entries', (req, res) => {
  const companyId = req.user.companyId;
  const userId = req.user.userId;
  const userRole = req.user.role;
  const { user_id, start_date, end_date, approved } = req.query;

  let query = `
    SELECT te.*, u.full_name, u.employee_id, l.location_name
    FROM time_entries te
    JOIN users u ON te.user_id = u.id
    LEFT JOIN locations l ON te.location_id = l.id
    WHERE te.company_id = ?
  `;
  const params = [companyId];

  // Non-managers see only their entries
  if (!['corporate_admin', 'business_owner', 'regional_manager', 'district_manager', 'store_manager', 'admin'].includes(userRole)) {
    query += ' AND te.user_id = ?';
    params.push(userId);
  } else if (user_id) {
    query += ' AND te.user_id = ?';
    params.push(user_id);
  }

  if (start_date) {
    query += ' AND DATE(te.clock_in) >= ?';
    params.push(start_date);
  }

  if (end_date) {
    query += ' AND DATE(te.clock_in) <= ?';
    params.push(end_date);
  }

  if (approved === 'true') {
    query += ' AND te.approved_by_user_id IS NOT NULL';
  } else if (approved === 'false') {
    query += ' AND te.approved_by_user_id IS NULL AND te.clock_out IS NOT NULL';
  }

  query += ' ORDER BY te.clock_in DESC LIMIT 100';

  db.all(query, params, (err, entries) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ entries });
  });
});

/**
 * PUT /api/scheduling/time/entries/:id/approve
 * Approve time entry
 */
router.put('/time/entries/:id/approve', requirePermission('EMPLOYEES.APPROVE_TIME'), (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const approvedBy = req.user.userId;

  db.run(
    `UPDATE time_entries SET approved_by_user_id = ?, approved_at = CURRENT_TIMESTAMP
     WHERE id = ? AND company_id = ? AND clock_out IS NOT NULL`,
    [approvedBy, id, companyId],
    function(err) {
      if (err || this.changes === 0) {
        return res.status(400).json({ error: 'Failed to approve entry' });
      }
      res.json({ success: true });
    }
  );
});

/**
 * GET /api/scheduling/time/status
 * Get current clock status for user
 */
router.get('/time/status', (req, res) => {
  const userId = req.user.userId;

  db.get(
    'SELECT * FROM time_entries WHERE user_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1',
    [userId],
    (err, entry) => {
      if (err) return res.status(500).json({ error: 'Database error' });

      if (!entry) {
        return res.json({ clocked_in: false });
      }

      res.json({
        clocked_in: true,
        clock_in: entry.clock_in,
        on_break: entry.break_start && !entry.break_end,
        break_start: entry.break_start,
        location_id: entry.location_id
      });
    }
  );
});

module.exports = router;
