/**
 * ============================================================================
 * Promotions Routes - Enterprise Promotion Engine
 * ============================================================================
 * Handles promotions, discount rules, and promotion approvals.
 * ============================================================================
 */

const express = require('express');
const db = require('../database');
const { authenticateToken, requireCompany, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);
router.use(requireCompany);

// ========== PROMOTIONS CRUD ==========

/**
 * GET /api/promotions
 * List all promotions (with optional filters)
 */
router.get('/', requirePermission('PROMOTIONS.VIEW'), (req, res) => {
  const companyId = req.user.companyId;
  const { active_only, type, location_id } = req.query;

  let query = `SELECT * FROM promotions WHERE company_id = ?`;
  const params = [companyId];

  if (active_only === 'true') {
    query += ` AND is_active = 1 AND start_date <= NOW() AND end_date >= NOW()`;
  }

  if (type) {
    params.push(type);
    query += ` AND promotion_type = ?`;
  }

  query += ` ORDER BY priority DESC, created_at DESC`;

  db.all(query, params, (err, promotions) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ promotions });
  });
});

/**
 * GET /api/promotions/:id
 * Get promotion details
 */
router.get('/:id', requirePermission('PROMOTIONS.VIEW'), (req, res) => {
  db.get('SELECT * FROM promotions WHERE id = ? AND company_id = ?',
    [req.params.id, req.user.companyId], (err, promotion) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!promotion) return res.status(404).json({ error: 'Promotion not found' });
      res.json({ promotion });
    });
});

/**
 * POST /api/promotions
 * Create a new promotion
 */
router.post('/', requirePermission('PROMOTIONS.CREATE'), (req, res) => {
  const {
    promotion_code, promotion_name, promotion_type, description, rules,
    discount_value, discount_percentage, minimum_purchase, maximum_discount,
    usage_limit, usage_per_customer, start_date, end_date,
    day_of_week, start_time, end_time, location_ids, customer_tier_ids,
    requires_approval, approval_threshold, is_stackable, priority
  } = req.body;

  if (!promotion_name || !promotion_type || !rules || !start_date || !end_date) {
    return res.status(400).json({ error: 'Missing required fields: promotion_name, promotion_type, rules, start_date, end_date' });
  }

  db.run(`INSERT INTO promotions (
    company_id, promotion_code, promotion_name, promotion_type, description, rules,
    discount_value, discount_percentage, minimum_purchase, maximum_discount,
    usage_limit, usage_per_customer, start_date, end_date,
    day_of_week, start_time, end_time, location_ids, customer_tier_ids,
    requires_approval, approval_threshold, is_stackable, priority,
    created_by_user_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.user.companyId, promotion_code || null, promotion_name, promotion_type,
      description || null, JSON.stringify(rules),
      discount_value || null, discount_percentage || null,
      minimum_purchase || null, maximum_discount || null,
      usage_limit || null, usage_per_customer || null,
      start_date, end_date,
      day_of_week ? JSON.stringify(day_of_week) : null,
      start_time || null, end_time || null,
      location_ids ? JSON.stringify(location_ids) : null,
      customer_tier_ids ? JSON.stringify(customer_tier_ids) : null,
      requires_approval || 0, approval_threshold || null,
      is_stackable || 0, priority || 0,
      req.user.userId
    ],
    function(err) {
      if (err) return res.status(500).json({ error: 'Database error', details: err.message });
      res.status(201).json({ message: 'Promotion created', id: this.lastID });
    });
});

/**
 * PUT /api/promotions/:id
 * Update a promotion
 */
router.put('/:id', requirePermission('PROMOTIONS.EDIT'), (req, res) => {
  const {
    promotion_name, promotion_type, description, rules,
    discount_value, discount_percentage, minimum_purchase, maximum_discount,
    usage_limit, usage_per_customer, start_date, end_date,
    day_of_week, start_time, end_time, location_ids, customer_tier_ids,
    requires_approval, approval_threshold, is_stackable, priority, is_active
  } = req.body;

  db.run(`UPDATE promotions SET
    promotion_name = COALESCE(?, promotion_name),
    promotion_type = COALESCE(?, promotion_type),
    description = COALESCE(?, description),
    rules = COALESCE(?, rules),
    discount_value = COALESCE(?, discount_value),
    discount_percentage = COALESCE(?, discount_percentage),
    minimum_purchase = COALESCE(?, minimum_purchase),
    maximum_discount = COALESCE(?, maximum_discount),
    usage_limit = COALESCE(?, usage_limit),
    usage_per_customer = COALESCE(?, usage_per_customer),
    start_date = COALESCE(?, start_date),
    end_date = COALESCE(?, end_date),
    requires_approval = COALESCE(?, requires_approval),
    is_stackable = COALESCE(?, is_stackable),
    priority = COALESCE(?, priority),
    is_active = COALESCE(?, is_active)
    WHERE id = ? AND company_id = ?`,
    [
      promotion_name, promotion_type, description,
      rules ? JSON.stringify(rules) : null,
      discount_value, discount_percentage, minimum_purchase, maximum_discount,
      usage_limit, usage_per_customer, start_date, end_date,
      requires_approval, is_stackable, priority, is_active,
      req.params.id, req.user.companyId
    ],
    function(err) {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (this.changes === 0) return res.status(404).json({ error: 'Promotion not found' });
      res.json({ message: 'Promotion updated' });
    });
});

/**
 * DELETE /api/promotions/:id
 * Delete (deactivate) a promotion
 */
router.delete('/:id', requirePermission('PROMOTIONS.DELETE'), (req, res) => {
  db.run('UPDATE promotions SET is_active = 0 WHERE id = ? AND company_id = ?',
    [req.params.id, req.user.companyId],
    function(err) {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (this.changes === 0) return res.status(404).json({ error: 'Promotion not found' });
      res.json({ message: 'Promotion deactivated' });
    });
});

// ========== PROMOTION VALIDATION & USAGE ==========

/**
 * POST /api/promotions/validate
 * Validate a promotion code for a sale
 */
router.post('/validate', requirePermission('PROMOTIONS.APPLY'), (req, res) => {
  const { promotion_code, sale_total, customer_id, location_id } = req.body;

  if (!promotion_code) {
    return res.status(400).json({ error: 'Promotion code is required' });
  }

  db.get(`SELECT * FROM promotions
    WHERE company_id = ? AND promotion_code = ? AND is_active = 1
    AND start_date <= NOW() AND end_date >= NOW()`,
    [req.user.companyId, promotion_code],
    (err, promo) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!promo) return res.status(404).json({ error: 'Invalid or expired promotion code' });

      // Check usage limit
      if (promo.usage_limit && promo.current_usage_count >= promo.usage_limit) {
        return res.status(400).json({ error: 'Promotion usage limit reached' });
      }

      // Check minimum purchase
      if (promo.minimum_purchase && sale_total < promo.minimum_purchase) {
        return res.status(400).json({
          error: `Minimum purchase of ${promo.minimum_purchase} required`,
          minimum_purchase: promo.minimum_purchase
        });
      }

      // Check per-customer usage
      if (promo.usage_per_customer && customer_id) {
        db.get(`SELECT COUNT(*) as usage_count FROM promotion_usage
          WHERE promotion_id = ? AND customer_id = ?`,
          [promo.id, customer_id],
          (err2, usage) => {
            if (err2) return res.status(500).json({ error: 'Database error' });
            if (usage.usage_count >= promo.usage_per_customer) {
              return res.status(400).json({ error: 'Customer has reached usage limit for this promotion' });
            }
            returnValidPromotion(res, promo, sale_total);
          });
      } else {
        returnValidPromotion(res, promo, sale_total);
      }
    });
});

function returnValidPromotion(res, promo, sale_total) {
  let discount = 0;
  if (promo.discount_percentage) {
    discount = (sale_total * promo.discount_percentage) / 100;
    if (promo.maximum_discount && discount > promo.maximum_discount) {
      discount = promo.maximum_discount;
    }
  } else if (promo.discount_value) {
    discount = promo.discount_value;
  }

  res.json({
    valid: true,
    promotion: {
      id: promo.id,
      name: promo.promotion_name,
      type: promo.promotion_type,
      discount_amount: parseFloat(discount.toFixed(2)),
      requires_approval: promo.requires_approval && discount > (promo.approval_threshold || 0)
    }
  });
}

/**
 * POST /api/promotions/:id/record-usage
 * Record that a promotion was used in a sale
 */
router.post('/:id/record-usage', requirePermission('PROMOTIONS.APPLY'), (req, res) => {
  const { sale_id, customer_id, discount_applied, location_id } = req.body;

  db.run(`INSERT INTO promotion_usage (promotion_id, sale_id, customer_id, discount_applied, location_id, applied_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?)`,
    [req.params.id, sale_id, customer_id || null, discount_applied, location_id || null, req.user.userId],
    function(err) {
      if (err) return res.status(500).json({ error: 'Database error' });

      // Increment usage counter
      db.run('UPDATE promotions SET current_usage_count = current_usage_count + 1 WHERE id = ?',
        [req.params.id], (err2) => {
          if (err2) console.error('Failed to update usage count:', err2);
          res.json({ message: 'Usage recorded', id: this.lastID });
        });
    });
});

/**
 * GET /api/promotions/:id/usage
 * Get usage stats for a promotion
 */
router.get('/:id/usage', requirePermission('PROMOTIONS.VIEW'), (req, res) => {
  db.all(`SELECT pu.*, c.name as customer_name
    FROM promotion_usage pu
    LEFT JOIN customers c ON pu.customer_id = c.id
    WHERE pu.promotion_id = ?
    ORDER BY pu.created_at DESC
    LIMIT 100`,
    [req.params.id],
    (err, usage) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ usage });
    });
});

// ========== PROMOTION APPROVALS ==========

/**
 * POST /api/promotions/approvals
 * Request approval for a promotion discount
 */
router.post('/approvals', requirePermission('PROMOTIONS.APPLY'), (req, res) => {
  const { promotion_id, sale_id, discount_amount } = req.body;

  db.run(`INSERT INTO promotion_approvals (promotion_id, sale_id, requested_by_user_id, discount_amount)
    VALUES (?, ?, ?, ?)`,
    [promotion_id, sale_id || null, req.user.userId, discount_amount],
    function(err) {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.status(201).json({ message: 'Approval requested', id: this.lastID });
    });
});

/**
 * GET /api/promotions/approvals/pending
 * Get pending promotion approvals
 */
router.get('/approvals/pending', requirePermission('PROMOTIONS.APPROVE'), (req, res) => {
  db.all(`SELECT pa.*, p.promotion_name, u.full_name as requested_by
    FROM promotion_approvals pa
    JOIN promotions p ON pa.promotion_id = p.id
    JOIN users u ON pa.requested_by_user_id = u.id
    WHERE p.company_id = ? AND pa.status = 'pending'
    ORDER BY pa.requested_at DESC`,
    [req.user.companyId],
    (err, approvals) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ approvals });
    });
});

/**
 * PUT /api/promotions/approvals/:id
 * Approve or reject a promotion approval request
 */
router.put('/approvals/:id', requirePermission('PROMOTIONS.APPROVE'), (req, res) => {
  const { status, rejection_reason } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be approved or rejected' });
  }

  db.run(`UPDATE promotion_approvals SET
    status = ?, approved_by_user_id = ?, approved_at = NOW(),
    rejection_reason = ?
    WHERE id = ?`,
    [status, req.user.userId, rejection_reason || null, req.params.id],
    function(err) {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (this.changes === 0) return res.status(404).json({ error: 'Approval not found' });
      res.json({ message: `Promotion ${status}` });
    });
});

module.exports = router;
