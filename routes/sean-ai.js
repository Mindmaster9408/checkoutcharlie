const express = require('express');
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Sean learns from user interactions
router.post('/learn/interaction', (req, res) => {
  const { interactionType, component, productId, metadata } = req.body;
  const userId = req.user.userId;

  const eventData = JSON.stringify({
    productId,
    ...metadata
  });

  db.run(
    `INSERT INTO audit_trail (user_id, event_type, event_category, component, event_data)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, interactionType, 'user_interaction', component, eventData],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to log interaction' });
      }

      // Update button interaction tracking
      if (interactionType === 'button_click') {
        db.run(
          `INSERT INTO sean_button_interactions (user_id, button_id, button_label, screen_name, click_count)
           VALUES (?, ?, ?, ?, 1)
           ON CONFLICT(user_id, button_id, screen_name) DO UPDATE SET
           click_count = click_count + 1,
           last_clicked_at = CURRENT_TIMESTAMP`,
          [userId, component, metadata.label || component, metadata.screen || 'unknown']
        );
      }

      res.json({ success: true, logged: true });
    }
  );
});

// Sean learns about a product from barcode scan
router.post('/learn/product', (req, res) => {
  const { barcode, description, location } = req.body;
  const userId = req.user.userId;

  // Check if Sean already knows about this product
  db.get(
    'SELECT * FROM sean_product_knowledge WHERE barcode = ?',
    [barcode],
    (err, existing) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (existing) {
        // Update existing knowledge
        db.run(
          `UPDATE sean_product_knowledge
           SET times_seen = times_seen + 1,
               confidence_score = MIN(confidence_score + 0.1, 1.0),
               last_seen_at = CURRENT_TIMESTAMP
           WHERE barcode = ?`,
          [barcode]
        );

        return res.json({
          success: true,
          learned: false,
          message: 'Product already known',
          productSuggestion: {
            product_name: existing.product_name,
            category: existing.category,
            unit_of_measure: existing.unit_of_measure,
            vat_rate: existing.vat_rate,
            requires_vat: existing.requires_vat === 1
          }
        });
      }

      // Parse product info from description
      const productInfo = parseProductDescription(description);

      // New product - Sean learns it
      db.run(
        `INSERT INTO sean_product_knowledge
         (barcode, product_name, category, unit_of_measure, vat_rate, requires_vat, learned_from_location, learned_by_user_id, confidence_score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          barcode,
          productInfo.name,
          productInfo.category,
          productInfo.unit,
          productInfo.vatRate,
          productInfo.requiresVat ? 1 : 0,
          location || 'Unknown',
          userId,
          0.5
        ],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Failed to learn product' });
          }

          res.json({
            success: true,
            learned: true,
            productSuggestion: {
              product_name: productInfo.name,
              category: productInfo.category,
              unit_of_measure: productInfo.unit,
              vat_rate: productInfo.vatRate,
              requires_vat: productInfo.requiresVat,
              similar_products: []
            }
          });
        }
      );
    }
  );
});

// Sean assists with filling product details
router.post('/assist/product', (req, res) => {
  const { barcode, description } = req.body;

  if (!description) {
    return res.status(400).json({ error: 'Description required' });
  }

  // Parse the description to extract product details
  const productData = parseProductDescription(description);

  // Check if Sean has seen this barcode before
  if (barcode) {
    db.get(
      'SELECT * FROM sean_product_knowledge WHERE barcode = ?',
      [barcode],
      (err, known) => {
        if (known) {
          return res.json({
            success: true,
            source: 'sean_memory',
            productData: {
              product_name: known.product_name,
              searchable_name: known.product_name.toLowerCase(),
              category: known.category,
              unit_of_measure: known.unit_of_measure,
              vat_rate: known.vat_rate,
              requires_vat: known.requires_vat === 1,
              confidence: known.confidence_score
            }
          });
        }

        // Sean doesn't know this product, use AI parsing
        returnParsedProduct(res, productData);
      }
    );
  } else {
    returnParsedProduct(res, productData);
  }
});

// Get sales pattern insights
router.get('/insights/sales-patterns', (req, res) => {
  const { tillSessionId, startDate, endDate } = req.query;

  let query = `
    SELECT
      p.product_name,
      p.category,
      COUNT(si.id) as times_sold,
      SUM(si.quantity) as total_quantity,
      SUM(si.total_price) as total_revenue,
      strftime('%H', s.created_at) as hour_of_day
    FROM sale_items si
    JOIN sales s ON si.sale_id = s.id
    JOIN products p ON si.product_id = p.id
    WHERE 1=1
  `;

  const params = [];

  if (tillSessionId) {
    query += ' AND s.till_session_id = ?';
    params.push(tillSessionId);
  }

  if (startDate) {
    query += ' AND s.created_at >= ?';
    params.push(startDate);
  }

  if (endDate) {
    query += ' AND s.created_at <= ?';
    params.push(endDate);
  }

  query += `
    GROUP BY p.id, hour_of_day
    ORDER BY total_revenue DESC
    LIMIT 20
  `;

  db.all(query, params, (err, salesData) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Calculate peak hours
    const hourlyData = {};
    salesData.forEach(item => {
      const hour = item.hour_of_day;
      if (!hourlyData[hour]) {
        hourlyData[hour] = { transactions: 0, revenue: 0 };
      }
      hourlyData[hour].transactions += item.times_sold;
      hourlyData[hour].revenue += item.total_revenue;
    });

    const peakHours = Object.entries(hourlyData)
      .sort((a, b) => b[1].transactions - a[1].transactions)
      .slice(0, 3)
      .map(([hour, data]) => `${hour}:00-${parseInt(hour)+1}:00`);

    res.json({
      insights: {
        peak_hours: peakHours,
        top_products: salesData.slice(0, 10).map(item => ({
          product_name: item.product_name,
          category: item.category,
          total_sold: item.total_quantity,
          revenue: item.total_revenue
        }))
      }
    });
  });
});

// Get cashier behavior insights
router.get('/insights/cashier-behavior', (req, res) => {
  const userId = req.query.userId || req.user.userId;

  // Get cashier transaction stats
  db.get(
    `SELECT
       COUNT(DISTINCT s.id) as total_transactions,
       AVG(julianday(s.created_at) - julianday(s.created_at)) * 24 * 60 as avg_time_minutes
     FROM sales s
     WHERE s.user_id = ?`,
    [userId],
    (err, stats) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      // Get most used features
      db.all(
        `SELECT button_id, button_label, click_count
         FROM sean_button_interactions
         WHERE user_id = ?
         ORDER BY click_count DESC
         LIMIT 10`,
        [userId],
        (err, buttons) => {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }

          db.get(
            'SELECT full_name FROM users WHERE id = ?',
            [userId],
            (err, user) => {
              res.json({
                cashier_id: userId,
                cashier_name: user ? user.full_name : 'Unknown',
                behavior_patterns: {
                  total_transactions: stats.total_transactions || 0,
                  avg_transaction_time: stats.avg_time_minutes ? `${stats.avg_time_minutes.toFixed(1)} minutes` : 'N/A',
                  most_used_features: buttons.map(b => b.button_id),
                  efficiency_score: calculateEfficiencyScore(stats, buttons)
                }
              });
            }
          );
        }
      );
    }
  );
});

// Helper function to parse product description
function parseProductDescription(description) {
  const lower = description.toLowerCase();

  // Extract weight/size
  const weightMatch = description.match(/(\d+(?:\.\d+)?)\s*(kg|g|l|ml|ea|pack)/i);
  const weight = weightMatch ? parseFloat(weightMatch[1]) : null;
  const unit = weightMatch ? weightMatch[2].toLowerCase() : 'ea';

  // Determine category based on keywords
  let category = 'General';
  const categoryKeywords = {
    'Beverages': ['cola', 'juice', 'water', 'drink', 'soda', 'beer', 'wine'],
    'Dairy': ['milk', 'cheese', 'butter', 'yogurt', 'cream'],
    'Bakery': ['bread', 'bun', 'roll', 'cake', 'pastry'],
    'Groceries': ['sugar', 'salt', 'flour', 'rice', 'pasta', 'oil'],
    'Produce': ['apple', 'banana', 'orange', 'tomato', 'potato', 'onion'],
    'Snacks': ['chips', 'chocolate', 'candy', 'biscuit', 'cookie'],
    'Meat': ['chicken', 'beef', 'pork', 'lamb', 'sausage', 'bacon']
  };

  for (const [cat, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(keyword => lower.includes(keyword))) {
      category = cat;
      break;
    }
  }

  // VAT determination (most items have VAT except basic foods in some regions)
  const vatExempt = ['bread', 'milk', 'fresh'];
  const requiresVat = !vatExempt.some(item => lower.includes(item));

  return {
    name: description,
    category: category,
    unit: unit,
    weight: weight,
    vatRate: requiresVat ? 15 : 0,
    requiresVat: requiresVat
  };
}

function returnParsedProduct(res, productData) {
  res.json({
    success: true,
    source: 'ai_parsing',
    productData: {
      product_name: productData.name,
      searchable_name: productData.name.toLowerCase(),
      category: productData.category,
      unit_of_measure: productData.unit,
      weight: productData.weight,
      vat_rate: productData.vatRate,
      requires_vat: productData.requiresVat,
      suggested_category: productData.category
    }
  });
}

function calculateEfficiencyScore(stats, buttons) {
  // Simple efficiency calculation
  const transactionCount = stats.total_transactions || 0;
  const avgTime = stats.avg_time_minutes || 5;

  // Lower average time = higher efficiency
  const timeScore = Math.max(0, 100 - (avgTime * 10));

  // More transactions = higher efficiency
  const volumeScore = Math.min(100, transactionCount * 2);

  return Math.round((timeScore + volumeScore) / 2);
}

module.exports = router;
