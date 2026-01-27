/**
 * ============================================================================
 * Loyalty Routes - Customer Loyalty Programs & Points
 * ============================================================================
 */

const express = require('express');
const db = require('../database');
const { authenticateToken, requireCompany, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);
router.use(requireCompany);

// ========== PROGRAMS ==========

router.get('/programs', requirePermission('LOYALTY.VIEW'), (req, res) => {
  db.all('SELECT * FROM loyalty_programs WHERE company_id = ?', [req.user.companyId], (err, programs) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ programs });
  });
});

router.post('/programs', requirePermission('LOYALTY.MANAGE_PROGRAM'), (req, res) => {
  const { program_name, points_per_currency, points_value, minimum_redemption, points_expiry_months } = req.body;

  db.run(`INSERT INTO loyalty_programs (company_id, program_name, points_per_currency, points_value, minimum_redemption, points_expiry_months)
    VALUES (?, ?, ?, ?, ?, ?)`,
    [req.user.companyId, program_name, points_per_currency || 1, points_value || 0.01, minimum_redemption || 100, points_expiry_months],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to create program' });
      res.status(201).json({ success: true, program_id: this.lastID });
    });
});

router.put('/programs/:id', requirePermission('LOYALTY.MANAGE_PROGRAM'), (req, res) => {
  const { id } = req.params;
  const { program_name, points_per_currency, points_value, minimum_redemption, points_expiry_months, is_active } = req.body;

  db.run(`UPDATE loyalty_programs SET program_name = COALESCE(?, program_name),
    points_per_currency = COALESCE(?, points_per_currency), points_value = COALESCE(?, points_value),
    minimum_redemption = COALESCE(?, minimum_redemption), points_expiry_months = ?, is_active = COALESCE(?, is_active)
    WHERE id = ? AND company_id = ?`,
    [program_name, points_per_currency, points_value, minimum_redemption, points_expiry_months, is_active, id, req.user.companyId],
    (err) => {
      if (err) return res.status(500).json({ error: 'Failed to update' });
      res.json({ success: true });
    });
});

// ========== TIERS ==========

router.get('/programs/:id/tiers', requirePermission('LOYALTY.VIEW'), (req, res) => {
  db.all('SELECT * FROM loyalty_tiers WHERE program_id = ? ORDER BY tier_order',
    [req.params.id], (err, tiers) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ tiers });
    });
});

router.post('/programs/:id/tiers', requirePermission('LOYALTY.MANAGE_TIERS'), (req, res) => {
  const { tier_name, tier_order, min_points_required, min_spend_required, points_multiplier, benefits, color_code } = req.body;

  db.run(`INSERT INTO loyalty_tiers (program_id, tier_name, tier_order, min_points_required, min_spend_required, points_multiplier, benefits, color_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.params.id, tier_name, tier_order, min_points_required, min_spend_required, points_multiplier || 1, benefits ? JSON.stringify(benefits) : null, color_code],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to create tier' });
      res.status(201).json({ success: true, tier_id: this.lastID });
    });
});

router.put('/tiers/:id', requirePermission('LOYALTY.MANAGE_TIERS'), (req, res) => {
  const { tier_name, tier_order, min_points_required, points_multiplier, benefits, color_code } = req.body;

  db.run(`UPDATE loyalty_tiers SET tier_name = COALESCE(?, tier_name), tier_order = COALESCE(?, tier_order),
    min_points_required = COALESCE(?, min_points_required), points_multiplier = COALESCE(?, points_multiplier),
    benefits = ?, color_code = ? WHERE id = ?`,
    [tier_name, tier_order, min_points_required, points_multiplier, benefits ? JSON.stringify(benefits) : null, color_code, req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: 'Failed to update' });
      res.json({ success: true });
    });
});

// ========== CUSTOMER LOYALTY ==========

router.get('/customers/:customerId', requirePermission('LOYALTY.VIEW'), (req, res) => {
  db.get(`SELECT cl.*, lp.program_name, lt.tier_name, lt.points_multiplier
    FROM customer_loyalty cl
    JOIN loyalty_programs lp ON cl.program_id = lp.id
    LEFT JOIN loyalty_tiers lt ON cl.current_tier_id = lt.id
    WHERE cl.customer_id = ?`, [req.params.customerId], (err, loyalty) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ loyalty });
    });
});

router.post('/enroll', requirePermission('LOYALTY.ENROLL_CUSTOMER'), (req, res) => {
  const { customer_id, program_id } = req.body;
  const loyaltyNumber = `LYL-${Date.now().toString(36).toUpperCase()}`;

  db.run(`INSERT INTO customer_loyalty (customer_id, program_id, loyalty_number, enrolled_location_id)
    VALUES (?, ?, ?, ?)`,
    [customer_id, program_id, loyaltyNumber, req.user.locationId],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to enroll' });
      res.status(201).json({ success: true, loyalty_id: this.lastID, loyalty_number: loyaltyNumber });
    });
});

router.post('/earn', requirePermission('LOYALTY.VIEW'), (req, res) => {
  const { customer_id, sale_id, amount_spent } = req.body;

  // Get customer loyalty and program details
  db.get(`SELECT cl.*, lp.points_per_currency, lt.points_multiplier
    FROM customer_loyalty cl
    JOIN loyalty_programs lp ON cl.program_id = lp.id
    LEFT JOIN loyalty_tiers lt ON cl.current_tier_id = lt.id
    WHERE cl.customer_id = ? AND lp.is_active = 1`,
    [customer_id], (err, loyalty) => {
      if (!loyalty) return res.json({ success: false, message: 'Customer not enrolled' });

      const multiplier = loyalty.points_multiplier || 1;
      const pointsEarned = Math.floor(amount_spent * loyalty.points_per_currency * multiplier);
      const newBalance = loyalty.points_balance + pointsEarned;
      const newLifetime = loyalty.lifetime_points + pointsEarned;

      db.run(`UPDATE customer_loyalty SET points_balance = ?, lifetime_points = ?, lifetime_spend = lifetime_spend + ?
        WHERE id = ?`, [newBalance, newLifetime, amount_spent, loyalty.id], (err) => {
          if (err) return res.status(500).json({ error: 'Failed to award points' });

          // Log transaction
          db.run(`INSERT INTO loyalty_transactions (customer_loyalty_id, transaction_type, points, balance_after, sale_id, location_id, processed_by_user_id, description)
            VALUES (?, 'earn', ?, ?, ?, ?, ?, ?)`,
            [loyalty.id, pointsEarned, newBalance, sale_id, req.user.locationId, req.user.userId, `Earned from sale R${amount_spent}`]);

          // Check for tier upgrade
          checkTierUpgrade(loyalty.id, newLifetime);

          res.json({ success: true, points_earned: pointsEarned, new_balance: newBalance });
        });
    });
});

router.post('/redeem', requirePermission('LOYALTY.REDEEM_POINTS'), (req, res) => {
  const { customer_id, points_to_redeem, sale_id } = req.body;

  db.get(`SELECT cl.*, lp.points_value, lp.minimum_redemption
    FROM customer_loyalty cl JOIN loyalty_programs lp ON cl.program_id = lp.id
    WHERE cl.customer_id = ?`, [customer_id], (err, loyalty) => {
      if (!loyalty) return res.status(404).json({ error: 'Customer not enrolled' });
      if (loyalty.points_balance < points_to_redeem) return res.status(400).json({ error: 'Insufficient points' });
      if (points_to_redeem < loyalty.minimum_redemption) return res.status(400).json({ error: `Minimum redemption is ${loyalty.minimum_redemption} points` });

      const newBalance = loyalty.points_balance - points_to_redeem;
      const discountValue = points_to_redeem * loyalty.points_value;

      db.run('UPDATE customer_loyalty SET points_balance = ? WHERE id = ?', [newBalance, loyalty.id], (err) => {
        if (err) return res.status(500).json({ error: 'Failed to redeem' });

        db.run(`INSERT INTO loyalty_transactions (customer_loyalty_id, transaction_type, points, balance_after, sale_id, location_id, processed_by_user_id, description)
          VALUES (?, 'redeem', ?, ?, ?, ?, ?, ?)`,
          [loyalty.id, -points_to_redeem, newBalance, sale_id, req.user.locationId, req.user.userId, `Redeemed for R${discountValue.toFixed(2)} discount`]);

        res.json({ success: true, discount_value: discountValue, new_balance: newBalance });
      });
    });
});

router.post('/adjust', requirePermission('LOYALTY.ADJUST_POINTS'), (req, res) => {
  const { customer_id, points, reason } = req.body;

  db.get('SELECT * FROM customer_loyalty WHERE customer_id = ?', [customer_id], (err, loyalty) => {
    if (!loyalty) return res.status(404).json({ error: 'Customer not enrolled' });

    const newBalance = loyalty.points_balance + points;
    if (newBalance < 0) return res.status(400).json({ error: 'Cannot reduce below zero' });

    db.run('UPDATE customer_loyalty SET points_balance = ?, lifetime_points = lifetime_points + ? WHERE id = ?',
      [newBalance, points > 0 ? points : 0, loyalty.id], (err) => {
        if (err) return res.status(500).json({ error: 'Failed to adjust' });

        db.run(`INSERT INTO loyalty_transactions (customer_loyalty_id, transaction_type, points, balance_after, processed_by_user_id, description)
          VALUES (?, 'adjust', ?, ?, ?, ?)`,
          [loyalty.id, points, newBalance, req.user.userId, reason || 'Manual adjustment']);

        res.json({ success: true, new_balance: newBalance });
      });
  });
});

router.get('/transactions', requirePermission('LOYALTY.VIEW'), (req, res) => {
  const { customer_id, limit } = req.query;

  db.all(`SELECT lt.*, c.name as customer_name FROM loyalty_transactions lt
    JOIN customer_loyalty cl ON lt.customer_loyalty_id = cl.id
    JOIN customers c ON cl.customer_id = c.id
    WHERE cl.customer_id = ? ORDER BY lt.created_at DESC LIMIT ?`,
    [customer_id, parseInt(limit) || 50], (err, transactions) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ transactions });
    });
});

// Helper to check tier upgrades
function checkTierUpgrade(loyaltyId, lifetimePoints) {
  db.get('SELECT program_id FROM customer_loyalty WHERE id = ?', [loyaltyId], (err, loyalty) => {
    if (!loyalty) return;

    db.get(`SELECT id FROM loyalty_tiers WHERE program_id = ? AND min_points_required <= ?
      ORDER BY min_points_required DESC LIMIT 1`,
      [loyalty.program_id, lifetimePoints], (err, newTier) => {
        if (newTier) {
          db.run('UPDATE customer_loyalty SET current_tier_id = ? WHERE id = ?', [newTier.id, loyaltyId]);
        }
      });
  });
}

module.exports = router;
