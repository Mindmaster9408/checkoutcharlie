const express = require('express');
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Get VAT settings
router.get('/settings', (req, res) => {
  db.get('SELECT * FROM vat_settings WHERE id = 1', [], (err, settings) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!settings) {
      return res.json({
        is_vat_registered: false,
        vat_number: null,
        vat_rate: 15.0
      });
    }

    res.json({
      is_vat_registered: settings.is_vat_registered === 1,
      vat_number: settings.vat_number,
      vat_rate: settings.vat_rate
    });
  });
});

// Update VAT settings
router.put('/settings', (req, res) => {
  const { is_vat_registered, vat_number, vat_rate } = req.body;
  const userId = req.user.userId;

  db.run(
    `UPDATE vat_settings
     SET is_vat_registered = ?,
         vat_number = ?,
         vat_rate = ?,
         updated_at = CURRENT_TIMESTAMP,
         updated_by_user_id = ?
     WHERE id = 1`,
    [is_vat_registered ? 1 : 0, vat_number, vat_rate || 15.0, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to update VAT settings' });
      }

      // Log audit event
      db.run(
        `INSERT INTO audit_trail (user_id, event_type, event_category, event_data)
         VALUES (?, ?, ?, ?)`,
        [userId, 'vat_settings_updated', 'settings', JSON.stringify({ is_vat_registered, vat_number, vat_rate })]
      );

      res.json({
        success: true,
        message: 'VAT settings updated successfully'
      });
    }
  );
});

// Get products with VAT information
router.get('/products', (req, res) => {
  db.get('SELECT vat_rate, is_vat_registered FROM vat_settings WHERE id = 1', [], (err, vatSettings) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    const isVatRegistered = vatSettings && vatSettings.is_vat_registered === 1;
    const vatRate = vatSettings ? vatSettings.vat_rate : 15.0;

    db.all('SELECT * FROM products WHERE is_active = 1 ORDER BY product_name', [], (err, products) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      const productsWithVat = products.map(product => {
        const requiresVat = product.requires_vat === 1;
        const productVatRate = product.vat_rate || vatRate;

        let priceExcludingVat, vatAmount, priceIncludingVat;

        if (isVatRegistered && requiresVat) {
          // Price includes VAT
          priceIncludingVat = parseFloat(product.unit_price);
          priceExcludingVat = priceIncludingVat / (1 + (productVatRate / 100));
          vatAmount = priceIncludingVat - priceExcludingVat;
        } else {
          // No VAT
          priceExcludingVat = parseFloat(product.unit_price);
          vatAmount = 0;
          priceIncludingVat = priceExcludingVat;
        }

        return {
          ...product,
          price_excluding_vat: priceExcludingVat,
          vat_amount: vatAmount,
          price_including_vat: priceIncludingVat,
          effective_vat_rate: requiresVat ? productVatRate : 0
        };
      });

      res.json({
        is_vat_registered: isVatRegistered,
        products: productsWithVat
      });
    });
  });
});

// Calculate VAT for a sale
router.post('/calculate', (req, res) => {
  const { items } = req.body;

  if (!items || !Array.isArray(items)) {
    return res.status(400).json({ error: 'Items array required' });
  }

  db.get('SELECT vat_rate, is_vat_registered FROM vat_settings WHERE id = 1', [], (err, vatSettings) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    const isVatRegistered = vatSettings && vatSettings.is_vat_registered === 1;
    const defaultVatRate = vatSettings ? vatSettings.vat_rate : 15.0;

    // Get product details
    const productIds = items.map(item => item.productId);
    const placeholders = productIds.map(() => '?').join(',');

    db.all(
      `SELECT id, unit_price, requires_vat, vat_rate FROM products WHERE id IN (${placeholders})`,
      productIds,
      (err, products) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }

        let subtotal = 0;
        let totalVat = 0;
        const itemCalculations = [];

        items.forEach(item => {
          const product = products.find(p => p.id === item.productId);
          if (!product) return;

          const quantity = item.quantity;
          const unitPrice = parseFloat(product.unit_price);
          const requiresVat = product.requires_vat === 1;
          const productVatRate = product.vat_rate || defaultVatRate;

          let itemSubtotal, itemVat, itemTotal;

          if (isVatRegistered && requiresVat) {
            // Price includes VAT - extract it
            itemTotal = unitPrice * quantity;
            itemSubtotal = itemTotal / (1 + (productVatRate / 100));
            itemVat = itemTotal - itemSubtotal;
          } else {
            // No VAT
            itemSubtotal = unitPrice * quantity;
            itemVat = 0;
            itemTotal = itemSubtotal;
          }

          subtotal += itemSubtotal;
          totalVat += itemVat;

          itemCalculations.push({
            productId: product.id,
            quantity,
            unit_price: unitPrice,
            subtotal: itemSubtotal,
            vat: itemVat,
            total: itemTotal,
            vat_rate: requiresVat ? productVatRate : 0
          });
        });

        res.json({
          is_vat_registered: isVatRegistered,
          subtotal: subtotal,
          vat: totalVat,
          total: subtotal + totalVat,
          items: itemCalculations
        });
      }
    );
  });
});

module.exports = router;
