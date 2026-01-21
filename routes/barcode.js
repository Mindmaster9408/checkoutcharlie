const express = require('express');
const db = require('../database');
const { authenticateToken, requireCompany } = require('../middleware/auth');

const router = express.Router();

// Apply authentication and company context to all routes
router.use(authenticateToken);
router.use(requireCompany);

// Get barcode settings
router.get('/settings', (req, res) => {
  const companyId = req.user.companyId;

  db.get('SELECT * FROM barcode_settings WHERE company_id = ?', [companyId], (err, settings) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    res.json({
      company_prefix: settings?.company_prefix || '600',
      current_sequence: settings?.current_sequence || 1000,
      barcode_type: settings?.barcode_type || 'EAN13',
      auto_generate: settings?.auto_generate === 1,
      last_generated: settings?.last_generated
    });
  });
});

// Update barcode settings
router.put('/settings', (req, res) => {
  const { company_prefix, current_sequence, barcode_type, auto_generate } = req.body;
  const userId = req.user.userId;
  const companyId = req.user.companyId;

  if (!company_prefix || company_prefix.length < 2 || company_prefix.length > 5) {
    return res.status(400).json({ error: 'Company prefix must be 2-5 digits' });
  }

  // Check if settings exist for this company
  db.get('SELECT id FROM barcode_settings WHERE company_id = ?', [companyId], (err, existing) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (existing) {
      db.run(
        `UPDATE barcode_settings
         SET company_prefix = ?,
             current_sequence = ?,
             barcode_type = ?,
             auto_generate = ?,
             updated_at = CURRENT_TIMESTAMP,
             updated_by_user_id = ?
         WHERE company_id = ?`,
        [company_prefix, current_sequence || 1000, barcode_type || 'EAN13', auto_generate ? 1 : 0, userId, companyId],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Failed to update settings' });
          }

          // Log audit
          db.run(
            `INSERT INTO audit_trail (company_id, user_id, event_type, event_category, event_data)
             VALUES (?, ?, ?, ?, ?)`,
            [companyId, userId, 'barcode_settings_updated', 'settings', JSON.stringify({ company_prefix, current_sequence })]
          );

          res.json({ success: true, message: 'Barcode settings updated' });
        }
      );
    } else {
      db.run(
        `INSERT INTO barcode_settings (company_id, company_prefix, current_sequence, barcode_type, auto_generate, updated_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [companyId, company_prefix, current_sequence || 1000, barcode_type || 'EAN13', auto_generate ? 1 : 0, userId],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Failed to create settings' });
          }

          res.json({ success: true, message: 'Barcode settings created' });
        }
      );
    }
  });
});

// Generate new company barcode
router.post('/generate', (req, res) => {
  const userId = req.user.userId;
  const companyId = req.user.companyId;

  db.get('SELECT * FROM barcode_settings WHERE company_id = ?', [companyId], (err, settings) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!settings) {
      return res.status(400).json({ error: 'Barcode settings not configured' });
    }

    const prefix = settings.company_prefix;
    const sequence = settings.current_sequence;

    // Generate barcode based on type
    let barcode;
    if (settings.barcode_type === 'EAN13') {
      barcode = generateEAN13(prefix, sequence);
    } else if (settings.barcode_type === 'EAN8') {
      barcode = generateEAN8(prefix, sequence);
    } else {
      // Default: simple format
      barcode = `${prefix}${String(sequence).padStart(10, '0')}`;
    }

    // Update sequence
    db.run(
      `UPDATE barcode_settings
       SET current_sequence = current_sequence + 1,
           last_generated = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE company_id = ?`,
      [barcode, companyId],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to generate barcode' });
        }

        // Log in history
        db.run(
          `INSERT INTO barcode_history (company_id, barcode, barcode_type, is_company_generated, assigned_by_user_id)
           VALUES (?, ?, ?, 1, ?)`,
          [companyId, barcode, settings.barcode_type, userId]
        );

        res.json({
          success: true,
          barcode: barcode,
          barcode_type: settings.barcode_type,
          next_sequence: sequence + 1
        });
      }
    );
  });
});

// Check if barcode exists
router.get('/check/:barcode', (req, res) => {
  const barcode = req.params.barcode;
  const companyId = req.user.companyId;

  // Check in products (scoped to company)
  db.get('SELECT id, product_code, product_name FROM products WHERE barcode = ? AND company_id = ?', [barcode, companyId], (err, product) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (product) {
      return res.json({
        exists: true,
        in_system: true,
        product: {
          id: product.id,
          code: product.product_code,
          name: product.product_name
        }
      });
    }

    // Check in history (scoped to company)
    db.get('SELECT * FROM barcode_history WHERE barcode = ? AND company_id = ?', [barcode, companyId], (err, history) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (history) {
        return res.json({
          exists: true,
          in_system: false,
          previously_used: true,
          was_company_generated: history.is_company_generated === 1
        });
      }

      // Check with Sean AI (global knowledge base)
      db.get('SELECT * FROM sean_product_knowledge WHERE barcode = ?', [barcode], (err, sean) => {
        if (sean) {
          return res.json({
            exists: false,
            in_system: false,
            sean_knows: true,
            suggestion: {
              product_name: sean.product_name,
              category: sean.category,
              unit_of_measure: sean.unit_of_measure,
              confidence: sean.confidence_score
            }
          });
        }

        res.json({
          exists: false,
          in_system: false,
          sean_knows: false
        });
      });
    });
  });
});

// Assign barcode to product
router.post('/assign', (req, res) => {
  const { barcode, productId } = req.body;
  const userId = req.user.userId;
  const companyId = req.user.companyId;

  if (!barcode || !productId) {
    return res.status(400).json({ error: 'Barcode and productId required' });
  }

  // Check if barcode already used (scoped to company)
  db.get('SELECT * FROM products WHERE barcode = ? AND company_id = ?', [barcode, companyId], (err, existing) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (existing && existing.id !== productId) {
      return res.status(400).json({
        error: 'Barcode already assigned to another product',
        product: {
          id: existing.id,
          name: existing.product_name
        }
      });
    }

    // Assign barcode to product (scoped to company)
    db.run(
      'UPDATE products SET barcode = ? WHERE id = ? AND company_id = ?',
      [barcode, productId, companyId],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to assign barcode' });
        }

        // Log in history
        db.run(
          `INSERT OR REPLACE INTO barcode_history (company_id, barcode, product_id, assigned_by_user_id)
           VALUES (?, ?, ?, ?)`,
          [companyId, barcode, productId, userId]
        );

        // Log audit
        db.run(
          `INSERT INTO audit_trail (company_id, user_id, event_type, event_category, event_data)
           VALUES (?, ?, ?, ?, ?)`,
          [companyId, userId, 'barcode_assigned', 'product', JSON.stringify({ barcode, productId })]
        );

        res.json({
          success: true,
          message: 'Barcode assigned successfully'
        });
      }
    );
  });
});

// Lookup product by barcode
router.get('/lookup/:barcode', (req, res) => {
  const barcode = req.params.barcode;
  const companyId = req.user.companyId;

  db.get('SELECT * FROM products WHERE barcode = ? AND company_id = ? AND is_active = 1', [barcode, companyId], (err, product) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!product) {
      // Check if Sean knows about it (global knowledge base)
      db.get('SELECT * FROM sean_product_knowledge WHERE barcode = ?', [barcode], (err, sean) => {
        if (sean) {
          return res.json({
            found: false,
            sean_suggestion: {
              product_name: sean.product_name,
              category: sean.category,
              unit_of_measure: sean.unit_of_measure,
              vat_rate: sean.vat_rate,
              requires_vat: sean.requires_vat === 1,
              confidence: sean.confidence_score,
              times_seen: sean.times_seen
            }
          });
        }

        return res.json({ found: false });
      });
      return;
    }

    res.json({
      found: true,
      product: product
    });
  });
});

// Get barcode history
router.get('/history', (req, res) => {
  const { productId, limit = 50 } = req.query;
  const companyId = req.user.companyId;

  let query = `
    SELECT
      bh.*,
      p.product_name,
      p.product_code,
      u.full_name as assigned_by
    FROM barcode_history bh
    LEFT JOIN products p ON bh.product_id = p.id
    LEFT JOIN users u ON bh.assigned_by_user_id = u.id
    WHERE bh.company_id = ?
  `;

  const params = [companyId];

  if (productId) {
    query += ' AND bh.product_id = ?';
    params.push(productId);
  }

  query += ' ORDER BY bh.assigned_at DESC LIMIT ?';
  params.push(parseInt(limit));

  db.all(query, params, (err, history) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    res.json({ history });
  });
});

// Validate barcode format
router.post('/validate', (req, res) => {
  const { barcode } = req.body;

  if (!barcode) {
    return res.status(400).json({ error: 'Barcode required' });
  }

  const validation = validateBarcode(barcode);

  res.json(validation);
});

// Helper Functions

function generateEAN13(prefix, sequence) {
  // EAN13 format: 3-digit prefix + 9-digit sequence + 1 check digit
  const code = prefix + String(sequence).padStart(9, '0');

  // Calculate check digit
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(code[i]);
    sum += (i % 2 === 0) ? digit : digit * 3;
  }
  const checkDigit = (10 - (sum % 10)) % 10;

  return code + checkDigit;
}

function generateEAN8(prefix, sequence) {
  // EAN8 format: 2-digit prefix + 5-digit sequence + 1 check digit
  const shortPrefix = prefix.substring(0, 2);
  const code = shortPrefix + String(sequence).padStart(5, '0');

  // Calculate check digit
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const digit = parseInt(code[i]);
    sum += (i % 2 === 0) ? digit * 3 : digit;
  }
  const checkDigit = (10 - (sum % 10)) % 10;

  return code + checkDigit;
}

function validateBarcode(barcode) {
  const numericOnly = /^\d+$/.test(barcode);

  if (!numericOnly) {
    return {
      valid: false,
      format: 'INVALID',
      error: 'Barcode must contain only numbers'
    };
  }

  const length = barcode.length;

  if (length === 13) {
    // EAN13 validation
    const checkDigit = parseInt(barcode[12]);
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      const digit = parseInt(barcode[i]);
      sum += (i % 2 === 0) ? digit : digit * 3;
    }
    const calculatedCheck = (10 - (sum % 10)) % 10;

    return {
      valid: checkDigit === calculatedCheck,
      format: 'EAN13',
      check_digit_valid: checkDigit === calculatedCheck
    };
  } else if (length === 8) {
    // EAN8 validation
    const checkDigit = parseInt(barcode[7]);
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      const digit = parseInt(barcode[i]);
      sum += (i % 2 === 0) ? digit * 3 : digit;
    }
    const calculatedCheck = (10 - (sum % 10)) % 10;

    return {
      valid: checkDigit === calculatedCheck,
      format: 'EAN8',
      check_digit_valid: checkDigit === calculatedCheck
    };
  } else if (length === 12) {
    return {
      valid: true,
      format: 'UPC-A',
      note: 'UPC-A format detected'
    };
  } else {
    return {
      valid: true,
      format: 'CUSTOM',
      length: length,
      note: 'Custom barcode format'
    };
  }
}

module.exports = router;
