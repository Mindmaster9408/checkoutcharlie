const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'pos_database.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  console.log('Creating Sean AI and Audit Trail tables...');

  // Audit Trail table - Every interaction logged
  db.run(`CREATE TABLE IF NOT EXISTS audit_trail (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    till_session_id INTEGER,
    event_type TEXT NOT NULL,
    event_category TEXT NOT NULL,
    component TEXT,
    event_data TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (till_session_id) REFERENCES till_sessions(id)
  )`);

  // Sean AI Learning - Product Knowledge
  db.run(`CREATE TABLE IF NOT EXISTS sean_product_knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode TEXT,
    product_name TEXT NOT NULL,
    category TEXT,
    unit_of_measure TEXT,
    vat_rate REAL,
    requires_vat INTEGER DEFAULT 1,
    learned_from_location TEXT,
    learned_by_user_id INTEGER,
    confidence_score REAL DEFAULT 0.5,
    times_seen INTEGER DEFAULT 1,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (learned_by_user_id) REFERENCES users(id)
  )`);

  // Sean AI Learning - Sales Patterns
  db.run(`CREATE TABLE IF NOT EXISTS sean_sales_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    hour_of_day INTEGER,
    day_of_week INTEGER,
    quantity_sold INTEGER DEFAULT 0,
    times_sold INTEGER DEFAULT 1,
    avg_transaction_value REAL,
    location TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);

  // Sean AI Learning - Cashier Behavior
  db.run(`CREATE TABLE IF NOT EXISTS sean_cashier_behavior (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    action_type TEXT NOT NULL,
    action_count INTEGER DEFAULT 1,
    avg_time_seconds REAL,
    success_rate REAL,
    last_action_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // Sean AI Learning - Button Interactions
  db.run(`CREATE TABLE IF NOT EXISTS sean_button_interactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    button_id TEXT NOT NULL,
    button_label TEXT,
    screen_name TEXT,
    click_count INTEGER DEFAULT 1,
    last_clicked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // VAT Settings
  db.run(`CREATE TABLE IF NOT EXISTS vat_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    is_vat_registered INTEGER DEFAULT 0,
    vat_number TEXT,
    vat_rate REAL DEFAULT 15.0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_by_user_id INTEGER,
    FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
  )`);

  // Add VAT fields to products table if not exists
  db.run(`ALTER TABLE products ADD COLUMN vat_rate REAL DEFAULT 15.0`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding vat_rate column:', err.message);
    }
  });

  db.run(`ALTER TABLE products ADD COLUMN requires_vat INTEGER DEFAULT 1`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding requires_vat column:', err.message);
    }
  });

  db.run(`ALTER TABLE products ADD COLUMN unit_of_measure TEXT DEFAULT 'ea'`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding unit_of_measure column:', err.message);
    }
  });

  db.run(`ALTER TABLE products ADD COLUMN barcode TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding barcode column:', err.message);
    }
  });

  db.run(`ALTER TABLE products ADD COLUMN weight REAL`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding weight column:', err.message);
    }
  });

  // Insert default VAT settings
  db.run(`INSERT OR IGNORE INTO vat_settings (id, is_vat_registered, vat_rate)
          VALUES (1, 1, 15.0)`);

  // Create indexes for performance
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_trail(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_trail(till_session_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_trail(event_type)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_trail(created_at)`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_sean_barcode ON sean_product_knowledge(barcode)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sean_product ON sean_sales_patterns(product_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sean_user ON sean_cashier_behavior(user_id)`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_product_barcode ON products(barcode)`);

  console.log('✓ Sean AI and Audit Trail tables created successfully!');
  console.log('✓ VAT management fields added to products');
  console.log('✓ Database ready for Sean AI learning');
});

db.close();
