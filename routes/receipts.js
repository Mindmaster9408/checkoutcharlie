/**
 * ============================================================================
 * Receipt Printing Routes - Thermal Printer Support
 * ============================================================================
 * Handles receipt generation and printing to network thermal printers.
 * Supports ESC/POS protocol for 80mm and 58mm thermal printers.
 * ============================================================================
 */

const express = require('express');
const net = require('net');
const db = require('../database');
const { authenticateToken, requireCompany, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);
router.use(requireCompany);

// ========== ESC/POS COMMANDS ==========
const ESC = '\x1B';
const GS = '\x1D';
const ESCPOS = {
  INIT: ESC + '@',                    // Initialize printer
  ALIGN_LEFT: ESC + 'a' + '\x00',     // Left align
  ALIGN_CENTER: ESC + 'a' + '\x01',   // Center align
  ALIGN_RIGHT: ESC + 'a' + '\x02',    // Right align
  BOLD_ON: ESC + 'E' + '\x01',        // Bold on
  BOLD_OFF: ESC + 'E' + '\x00',       // Bold off
  DOUBLE_WIDTH: ESC + '!' + '\x20',   // Double width
  DOUBLE_HEIGHT: ESC + '!' + '\x10', // Double height
  DOUBLE_BOTH: ESC + '!' + '\x30',    // Double width and height
  NORMAL: ESC + '!' + '\x00',         // Normal text
  UNDERLINE_ON: ESC + '-' + '\x01',   // Underline on
  UNDERLINE_OFF: ESC + '-' + '\x00',  // Underline off
  CUT_PAPER: GS + 'V' + '\x00',       // Full cut
  CUT_PARTIAL: GS + 'V' + '\x01',     // Partial cut
  FEED_LINES: (n) => ESC + 'd' + String.fromCharCode(n), // Feed n lines
  OPEN_DRAWER: ESC + 'p' + '\x00' + '\x19' + '\xFA', // Open cash drawer
  LINE: '-'.repeat(48) + '\n',        // Separator line (80mm)
  DOUBLE_LINE: '='.repeat(48) + '\n', // Double separator (80mm)
};

// ========== HELPER FUNCTIONS ==========

/**
 * Format currency for receipt
 */
function formatCurrency(amount) {
  return 'R ' + parseFloat(amount || 0).toFixed(2);
}

/**
 * Format date/time for receipt
 */
function formatDateTime(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-ZA') + ' ' + date.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Pad text for alignment (80mm paper = ~48 chars, 58mm = ~32 chars)
 */
function padLine(left, right, width = 48) {
  const padding = width - left.length - right.length;
  return left + ' '.repeat(Math.max(1, padding)) + right + '\n';
}

/**
 * Center text
 */
function centerText(text, width = 48) {
  const padding = Math.floor((width - text.length) / 2);
  return ' '.repeat(Math.max(0, padding)) + text + '\n';
}

/**
 * Wrap text to fit width
 */
function wrapText(text, width = 48) {
  if (!text) return '';
  const words = text.split(' ');
  let lines = [];
  let currentLine = '';

  words.forEach(word => {
    if ((currentLine + ' ' + word).length <= width) {
      currentLine = currentLine ? currentLine + ' ' + word : word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  });
  if (currentLine) lines.push(currentLine);

  return lines.join('\n') + '\n';
}

/**
 * Generate receipt content
 */
function generateReceiptContent(sale, items, settings, paperWidth = 80) {
  const width = paperWidth === 58 ? 32 : 48;
  const line = '-'.repeat(width) + '\n';
  const doubleLine = '='.repeat(width) + '\n';

  let receipt = '';

  // Initialize printer
  receipt += ESCPOS.INIT;

  // Header (centered, bold)
  receipt += ESCPOS.ALIGN_CENTER;
  receipt += ESCPOS.BOLD_ON;
  receipt += ESCPOS.DOUBLE_BOTH;
  receipt += (settings.receipt_header || settings.company_name || 'RECEIPT') + '\n';
  receipt += ESCPOS.NORMAL;
  receipt += ESCPOS.BOLD_OFF;

  // Company details
  if (settings.company_address) {
    receipt += wrapText(settings.company_address, width);
  }
  if (settings.company_phone) {
    receipt += 'Tel: ' + settings.company_phone + '\n';
  }
  if (settings.company_vat_number) {
    receipt += 'VAT: ' + settings.company_vat_number + '\n';
  }

  receipt += '\n';
  receipt += doubleLine;

  // Sale details
  receipt += ESCPOS.ALIGN_LEFT;
  receipt += 'Receipt: ' + sale.sale_number + '\n';
  receipt += 'Date: ' + formatDateTime(sale.created_at) + '\n';
  receipt += 'Cashier: ' + (sale.cashier_name || 'N/A') + '\n';
  if (sale.customer_name) {
    receipt += 'Customer: ' + sale.customer_name + '\n';
  }

  receipt += line;

  // Column headers
  receipt += ESCPOS.BOLD_ON;
  receipt += padLine('Item', 'Amount', width);
  receipt += ESCPOS.BOLD_OFF;
  receipt += line;

  // Items
  items.forEach(item => {
    const itemName = item.product_name || 'Unknown Item';
    const shortName = itemName.length > width - 15 ? itemName.substring(0, width - 18) + '...' : itemName;

    // Item name on first line
    receipt += shortName + '\n';

    // Quantity x Price = Total on second line
    const qtyPrice = `  ${item.quantity} x ${formatCurrency(item.unit_price)}`;
    const total = formatCurrency(item.total_price);
    receipt += padLine(qtyPrice, total, width);
  });

  receipt += line;

  // Totals
  receipt += padLine('Subtotal:', formatCurrency(sale.subtotal), width);
  if (sale.discount_amount && parseFloat(sale.discount_amount) > 0) {
    receipt += padLine('Discount:', '-' + formatCurrency(sale.discount_amount), width);
  }
  receipt += padLine('VAT (15%):', formatCurrency(sale.vat_amount), width);

  receipt += ESCPOS.BOLD_ON;
  receipt += ESCPOS.DOUBLE_HEIGHT;
  receipt += padLine('TOTAL:', formatCurrency(sale.total_amount), width);
  receipt += ESCPOS.NORMAL;
  receipt += ESCPOS.BOLD_OFF;

  receipt += line;

  // Payment
  receipt += 'Payment: ' + (sale.payment_method || 'Cash').toUpperCase() + '\n';
  if (sale.cash_received && parseFloat(sale.cash_received) > 0) {
    receipt += padLine('Tendered:', formatCurrency(sale.cash_received), width);
    receipt += padLine('Change:', formatCurrency(sale.change_due), width);
  }

  receipt += doubleLine;

  // Footer
  receipt += ESCPOS.ALIGN_CENTER;
  if (settings.receipt_footer) {
    receipt += wrapText(settings.receipt_footer, width);
  } else {
    receipt += 'Thank you for your purchase!\n';
    receipt += 'Please come again\n';
  }

  // VAT Summary
  receipt += '\n';
  receipt += 'VAT Summary:\n';
  const vatExcl = parseFloat(sale.total_amount) - parseFloat(sale.vat_amount);
  receipt += `Excl VAT: ${formatCurrency(vatExcl)} | VAT: ${formatCurrency(sale.vat_amount)}\n`;

  // Timestamp
  receipt += '\n';
  receipt += new Date().toISOString().replace('T', ' ').substring(0, 19) + '\n';

  receipt += ESCPOS.ALIGN_LEFT;

  // Feed and cut
  receipt += '\n\n\n\n\n';
  receipt += ESCPOS.CUT_PARTIAL;

  return receipt;
}

/**
 * Send data to network printer
 */
function sendToPrinter(ip, port, data) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();

    client.setTimeout(10000); // 10 second timeout

    client.connect(port, ip, () => {
      client.write(data, 'binary', (err) => {
        if (err) {
          client.destroy();
          reject(new Error('Failed to send data: ' + err.message));
        } else {
          // Give printer time to process
          setTimeout(() => {
            client.end();
            resolve({ success: true, message: 'Print job sent successfully' });
          }, 500);
        }
      });
    });

    client.on('timeout', () => {
      client.destroy();
      reject(new Error('Connection timeout - printer may be offline'));
    });

    client.on('error', (err) => {
      client.destroy();
      reject(new Error('Printer connection failed: ' + err.message));
    });

    client.on('close', () => {
      // Connection closed normally
    });
  });
}

// ========== RECEIPT PRINTERS CRUD ==========

/**
 * GET /api/receipts/printers
 * List all receipt printers for the company
 */
router.get('/printers', requirePermission('SETTINGS.VIEW'), (req, res) => {
  db.all('SELECT * FROM receipt_printers WHERE company_id = ? ORDER BY is_default DESC, printer_name',
    [req.user.companyId], (err, printers) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ printers });
    });
});

/**
 * POST /api/receipts/printers
 * Add a new receipt printer
 */
router.post('/printers', requirePermission('SETTINGS.EDIT'), (req, res) => {
  const { printer_name, printer_type, ip_address, port, is_default, paper_width } = req.body;

  if (!printer_name || !ip_address) {
    return res.status(400).json({ error: 'Printer name and IP address are required' });
  }

  // If setting as default, clear other defaults first
  const setDefault = is_default ? 1 : 0;

  if (setDefault) {
    db.run('UPDATE receipt_printers SET is_default = 0 WHERE company_id = ?', [req.user.companyId], (err) => {
      if (err) console.error('Failed to clear defaults:', err);
    });
  }

  db.run(`INSERT INTO receipt_printers (company_id, printer_name, printer_type, ip_address, port, is_default, paper_width)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [req.user.companyId, printer_name, printer_type || 'network', ip_address, port || 9100, setDefault, paper_width || 80],
    function(err) {
      if (err) return res.status(500).json({ error: 'Database error', details: err.message });
      res.status(201).json({ message: 'Printer added', id: this.lastID });
    });
});

/**
 * PUT /api/receipts/printers/:id
 * Update a receipt printer
 */
router.put('/printers/:id', requirePermission('SETTINGS.EDIT'), (req, res) => {
  const { printer_name, printer_type, ip_address, port, is_default, paper_width, is_active } = req.body;

  // If setting as default, clear other defaults first
  if (is_default) {
    db.run('UPDATE receipt_printers SET is_default = 0 WHERE company_id = ?', [req.user.companyId], (err) => {
      if (err) console.error('Failed to clear defaults:', err);
    });
  }

  db.run(`UPDATE receipt_printers SET
    printer_name = COALESCE(?, printer_name),
    printer_type = COALESCE(?, printer_type),
    ip_address = COALESCE(?, ip_address),
    port = COALESCE(?, port),
    is_default = COALESCE(?, is_default),
    paper_width = COALESCE(?, paper_width),
    is_active = COALESCE(?, is_active)
    WHERE id = ? AND company_id = ?`,
    [printer_name, printer_type, ip_address, port, is_default, paper_width, is_active, req.params.id, req.user.companyId],
    function(err) {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (this.changes === 0) return res.status(404).json({ error: 'Printer not found' });
      res.json({ message: 'Printer updated' });
    });
});

/**
 * DELETE /api/receipts/printers/:id
 * Remove a receipt printer
 */
router.delete('/printers/:id', requirePermission('SETTINGS.EDIT'), (req, res) => {
  db.run('DELETE FROM receipt_printers WHERE id = ? AND company_id = ?',
    [req.params.id, req.user.companyId],
    function(err) {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (this.changes === 0) return res.status(404).json({ error: 'Printer not found' });
      res.json({ message: 'Printer deleted' });
    });
});

/**
 * POST /api/receipts/printers/:id/test
 * Test printer connection
 */
router.post('/printers/:id/test', requirePermission('SETTINGS.EDIT'), async (req, res) => {
  db.get('SELECT * FROM receipt_printers WHERE id = ? AND company_id = ?',
    [req.params.id, req.user.companyId], async (err, printer) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!printer) return res.status(404).json({ error: 'Printer not found' });

      // Generate test receipt
      const width = printer.paper_width === 58 ? 32 : 48;
      const line = '-'.repeat(width) + '\n';

      let testReceipt = ESCPOS.INIT;
      testReceipt += ESCPOS.ALIGN_CENTER;
      testReceipt += ESCPOS.BOLD_ON;
      testReceipt += ESCPOS.DOUBLE_BOTH;
      testReceipt += 'PRINTER TEST\n';
      testReceipt += ESCPOS.NORMAL;
      testReceipt += ESCPOS.BOLD_OFF;
      testReceipt += line;
      testReceipt += 'Printer: ' + printer.printer_name + '\n';
      testReceipt += 'IP: ' + printer.ip_address + ':' + printer.port + '\n';
      testReceipt += 'Paper: ' + printer.paper_width + 'mm\n';
      testReceipt += line;
      testReceipt += 'Test Date: ' + new Date().toLocaleString('en-ZA') + '\n';
      testReceipt += '\n';
      testReceipt += 'If you can read this,\n';
      testReceipt += 'the printer is working!\n';
      testReceipt += '\n\n\n';
      testReceipt += ESCPOS.CUT_PARTIAL;

      try {
        const result = await sendToPrinter(printer.ip_address, printer.port, testReceipt);
        res.json({ success: true, message: 'Test print sent successfully' });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });
});

// ========== PRINT SALE RECEIPT ==========

/**
 * POST /api/receipts/print/:saleId
 * Print receipt for a sale
 */
router.post('/print/:saleId', requirePermission('POS.CREATE_SALE'), async (req, res) => {
  const { saleId } = req.params;
  const { printer_id, open_drawer } = req.body;
  const companyId = req.user.companyId;

  // Get sale details
  db.get(`
    SELECT s.*, u.full_name as cashier_name, c.name as customer_name
    FROM sales s
    LEFT JOIN users u ON s.user_id = u.id
    LEFT JOIN customers c ON s.customer_id = c.id
    WHERE s.id = ? AND s.company_id = ?
  `, [saleId, companyId], (err, sale) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!sale) return res.status(404).json({ error: 'Sale not found' });

    // Get sale items
    db.all(`
      SELECT si.*, p.product_name, p.product_code
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      WHERE si.sale_id = ?
    `, [saleId], (err, items) => {
      if (err) return res.status(500).json({ error: 'Database error' });

      // Get company settings
      db.get('SELECT * FROM company_settings WHERE company_id = ?', [companyId], (err, settings) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        settings = settings || {};

        // Get company info
        db.get('SELECT * FROM companies WHERE id = ?', [companyId], async (err, company) => {
          if (err) return res.status(500).json({ error: 'Database error' });

          // Merge company info into settings
          settings.company_name = company?.company_name || 'Store';
          settings.company_address = company?.address;
          settings.company_phone = company?.phone;
          settings.company_vat_number = company?.vat_number;

          // Get printer
          let printerQuery = 'SELECT * FROM receipt_printers WHERE company_id = ? AND is_active = 1';
          let printerParams = [companyId];

          if (printer_id) {
            printerQuery += ' AND id = ?';
            printerParams.push(printer_id);
          } else {
            printerQuery += ' AND is_default = 1';
          }

          db.get(printerQuery, printerParams, async (err, printer) => {
            if (err) return res.status(500).json({ error: 'Database error' });

            if (!printer) {
              // No printer configured - return receipt data for browser printing
              const receiptHtml = generateBrowserReceipt(sale, items, settings);
              return res.json({
                success: true,
                method: 'browser',
                message: 'No network printer configured - use browser print',
                receiptHtml
              });
            }

            // Generate receipt for thermal printer
            let receiptData = generateReceiptContent(sale, items, settings, printer.paper_width);

            // Add cash drawer command if requested
            if (open_drawer) {
              receiptData = ESCPOS.OPEN_DRAWER + receiptData;
            }

            try {
              await sendToPrinter(printer.ip_address, printer.port, receiptData);
              res.json({ success: true, method: 'thermal', message: 'Receipt printed successfully' });
            } catch (error) {
              // Fallback to browser print
              const receiptHtml = generateBrowserReceipt(sale, items, settings);
              res.status(500).json({
                success: false,
                error: error.message,
                method: 'browser',
                message: 'Printer error - use browser print instead',
                receiptHtml
              });
            }
          });
        });
      });
    });
  });
});

/**
 * Generate HTML receipt for browser printing
 */
function generateBrowserReceipt(sale, items, settings) {
  const formatCurrency = (amt) => 'R ' + parseFloat(amt || 0).toFixed(2);

  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Receipt ${sale.sale_number}</title>
  <style>
    @page { margin: 0; size: 80mm auto; }
    body {
      font-family: 'Courier New', monospace;
      font-size: 12px;
      width: 80mm;
      margin: 0 auto;
      padding: 5mm;
    }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .header { font-size: 18px; font-weight: bold; margin-bottom: 5px; }
    .line { border-top: 1px dashed #000; margin: 5px 0; }
    .double-line { border-top: 2px solid #000; margin: 5px 0; }
    .row { display: flex; justify-content: space-between; }
    .item-name { margin-bottom: 2px; }
    .item-detail { padding-left: 10px; display: flex; justify-content: space-between; }
    .total-row { font-size: 14px; font-weight: bold; }
    .footer { margin-top: 10px; font-size: 10px; }
  </style>
</head>
<body>
  <div class="center">
    <div class="header">${settings.company_name || 'RECEIPT'}</div>
    ${settings.company_address ? `<div>${settings.company_address}</div>` : ''}
    ${settings.company_phone ? `<div>Tel: ${settings.company_phone}</div>` : ''}
    ${settings.company_vat_number ? `<div>VAT: ${settings.company_vat_number}</div>` : ''}
  </div>

  <div class="double-line"></div>

  <div>
    <div class="row"><span>Receipt:</span><span>${sale.sale_number}</span></div>
    <div class="row"><span>Date:</span><span>${new Date(sale.created_at).toLocaleString('en-ZA')}</span></div>
    <div class="row"><span>Cashier:</span><span>${sale.cashier_name || 'N/A'}</span></div>
    ${sale.customer_name ? `<div class="row"><span>Customer:</span><span>${sale.customer_name}</span></div>` : ''}
  </div>

  <div class="line"></div>

  <div class="bold">
    <div class="row"><span>Item</span><span>Amount</span></div>
  </div>

  <div class="line"></div>`;

  items.forEach(item => {
    html += `
  <div>
    <div class="item-name">${item.product_name}</div>
    <div class="item-detail">
      <span>${item.quantity} x ${formatCurrency(item.unit_price)}</span>
      <span>${formatCurrency(item.total_price)}</span>
    </div>
  </div>`;
  });

  html += `
  <div class="line"></div>

  <div class="row"><span>Subtotal:</span><span>${formatCurrency(sale.subtotal)}</span></div>
  ${sale.discount_amount && parseFloat(sale.discount_amount) > 0 ? `<div class="row"><span>Discount:</span><span>-${formatCurrency(sale.discount_amount)}</span></div>` : ''}
  <div class="row"><span>VAT (15%):</span><span>${formatCurrency(sale.vat_amount)}</span></div>

  <div class="total-row row"><span>TOTAL:</span><span>${formatCurrency(sale.total_amount)}</span></div>

  <div class="line"></div>

  <div class="row"><span>Payment:</span><span>${(sale.payment_method || 'Cash').toUpperCase()}</span></div>
  ${sale.cash_received ? `
  <div class="row"><span>Tendered:</span><span>${formatCurrency(sale.cash_received)}</span></div>
  <div class="row"><span>Change:</span><span>${formatCurrency(sale.change_due)}</span></div>
  ` : ''}

  <div class="double-line"></div>

  <div class="center footer">
    ${settings.receipt_footer || 'Thank you for your purchase!<br>Please come again'}
  </div>

  <div class="center footer">
    <br>VAT Summary: Excl ${formatCurrency(parseFloat(sale.total_amount) - parseFloat(sale.vat_amount))} | VAT ${formatCurrency(sale.vat_amount)}
    <br><br>${new Date().toISOString().replace('T', ' ').substring(0, 19)}
  </div>
</body>
</html>`;

  return html;
}

/**
 * GET /api/receipts/preview/:saleId
 * Preview receipt (returns HTML for display)
 */
router.get('/preview/:saleId', requirePermission('POS.VIEW_REPORTS'), (req, res) => {
  const { saleId } = req.params;
  const companyId = req.user.companyId;

  db.get(`
    SELECT s.*, u.full_name as cashier_name, c.name as customer_name
    FROM sales s
    LEFT JOIN users u ON s.user_id = u.id
    LEFT JOIN customers c ON s.customer_id = c.id
    WHERE s.id = ? AND s.company_id = ?
  `, [saleId, companyId], (err, sale) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!sale) return res.status(404).json({ error: 'Sale not found' });

    db.all(`
      SELECT si.*, p.product_name, p.product_code
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      WHERE si.sale_id = ?
    `, [saleId], (err, items) => {
      if (err) return res.status(500).json({ error: 'Database error' });

      db.get('SELECT * FROM company_settings WHERE company_id = ?', [companyId], (err, settings) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        settings = settings || {};

        db.get('SELECT * FROM companies WHERE id = ?', [companyId], (err, company) => {
          if (err) return res.status(500).json({ error: 'Database error' });

          settings.company_name = company?.company_name || 'Store';
          settings.company_address = company?.address;
          settings.company_phone = company?.phone;
          settings.company_vat_number = company?.vat_number;

          const receiptHtml = generateBrowserReceipt(sale, items, settings);
          res.json({ receiptHtml, sale, items });
        });
      });
    });
  });
});

/**
 * POST /api/receipts/open-drawer
 * Open cash drawer (without printing)
 */
router.post('/open-drawer', requirePermission('POS.CREATE_SALE'), async (req, res) => {
  const { printer_id } = req.body;
  const companyId = req.user.companyId;

  let printerQuery = 'SELECT * FROM receipt_printers WHERE company_id = ? AND is_active = 1';
  let printerParams = [companyId];

  if (printer_id) {
    printerQuery += ' AND id = ?';
    printerParams.push(printer_id);
  } else {
    printerQuery += ' AND is_default = 1';
  }

  db.get(printerQuery, printerParams, async (err, printer) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!printer) return res.status(404).json({ error: 'No printer configured' });

    try {
      await sendToPrinter(printer.ip_address, printer.port, ESCPOS.OPEN_DRAWER);
      res.json({ success: true, message: 'Cash drawer opened' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
});

/**
 * GET /api/receipts/settings
 * Get receipt settings
 */
router.get('/settings', requirePermission('SETTINGS.VIEW'), (req, res) => {
  db.get('SELECT receipt_header, receipt_footer, auto_print_receipt FROM company_settings WHERE company_id = ?',
    [req.user.companyId], (err, settings) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ settings: settings || {} });
    });
});

/**
 * PUT /api/receipts/settings
 * Update receipt settings
 */
router.put('/settings', requirePermission('SETTINGS.EDIT'), (req, res) => {
  const { receipt_header, receipt_footer, auto_print_receipt } = req.body;

  db.run(`INSERT INTO company_settings (company_id, receipt_header, receipt_footer, auto_print_receipt)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(company_id) DO UPDATE SET
    receipt_header = COALESCE(?, receipt_header),
    receipt_footer = COALESCE(?, receipt_footer),
    auto_print_receipt = COALESCE(?, auto_print_receipt)`,
    [req.user.companyId, receipt_header, receipt_footer, auto_print_receipt,
     receipt_header, receipt_footer, auto_print_receipt],
    function(err) {
      if (err) return res.status(500).json({ error: 'Database error', details: err.message });
      res.json({ message: 'Settings updated' });
    });
});

module.exports = router;
