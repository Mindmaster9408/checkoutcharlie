const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'pos_database.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  console.log('Creating barcode management tables...');

  // Barcode Settings - Company barcode configuration
  db.run(`CREATE TABLE IF NOT EXISTS barcode_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_prefix TEXT NOT NULL,
    current_sequence INTEGER DEFAULT 1,
    barcode_type TEXT DEFAULT 'EAN13',
    auto_generate INTEGER DEFAULT 1,
    last_generated TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_by_user_id INTEGER,
    FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
  )`);

  // Barcode History - Track all barcodes ever used
  db.run(`CREATE TABLE IF NOT EXISTS barcode_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode TEXT NOT NULL UNIQUE,
    product_id INTEGER,
    barcode_type TEXT,
    is_company_generated INTEGER DEFAULT 0,
    assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    assigned_by_user_id INTEGER,
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (assigned_by_user_id) REFERENCES users(id)
  )`);

  // Insert default barcode settings (example: South African company prefix)
  db.run(`INSERT OR IGNORE INTO barcode_settings (id, company_prefix, current_sequence, barcode_type)
          VALUES (1, '600', 1000, 'EAN13')`);

  // Create index on barcodes for fast lookup
  db.run(`CREATE INDEX IF NOT EXISTS idx_barcode_history_barcode ON barcode_history(barcode)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_barcode_history_product ON barcode_history(product_id)`);

  console.log('✓ Barcode management tables created successfully!');
  console.log('✓ Default barcode prefix set to: 600 (South Africa)');
  console.log('✓ Starting sequence: 1000');
  console.log('✓ Barcode type: EAN13');
});

db.close();
