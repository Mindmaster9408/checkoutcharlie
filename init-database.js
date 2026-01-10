const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(__dirname, 'pos_database.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Enable foreign keys
  db.run('PRAGMA foreign_keys = ON');

  // Users table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Tills table
  db.run(`CREATE TABLE IF NOT EXISTS tills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    till_name TEXT UNIQUE NOT NULL,
    till_number TEXT UNIQUE NOT NULL,
    location TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Till Sessions table
  db.run(`CREATE TABLE IF NOT EXISTS till_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    till_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    opening_balance REAL NOT NULL,
    closing_balance REAL,
    expected_balance REAL,
    variance REAL,
    status TEXT DEFAULT 'open',
    opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME,
    notes TEXT,
    FOREIGN KEY (till_id) REFERENCES tills(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // Products table
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_code TEXT UNIQUE NOT NULL,
    product_name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    unit_price REAL NOT NULL,
    cost_price REAL,
    stock_quantity INTEGER DEFAULT 0,
    min_stock_level INTEGER DEFAULT 10,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Sales table
  db.run(`CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_number TEXT UNIQUE NOT NULL,
    till_session_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    subtotal REAL NOT NULL,
    vat_amount REAL NOT NULL,
    total_amount REAL NOT NULL,
    payment_method TEXT NOT NULL,
    status TEXT DEFAULT 'completed',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (till_session_id) REFERENCES till_sessions(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // Sale Items table
  db.run(`CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    total_price REAL NOT NULL,
    FOREIGN KEY (sale_id) REFERENCES sales(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);

  // Customers table
  db.run(`CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact_person TEXT,
    contact_number TEXT,
    email TEXT,
    address_line_1 TEXT,
    address_line_2 TEXT,
    suburb TEXT,
    city TEXT,
    province TEXT,
    postal_code TEXT,
    tax_reference TEXT,
    company TEXT,
    customer_type TEXT DEFAULT 'Cash Sale Customer',
    custom_field TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Insert demo user
  const passwordHash = bcrypt.hashSync('demo123', 10);
  db.run(`INSERT OR IGNORE INTO users (username, password_hash, full_name, role)
          VALUES ('demo', ?, 'Demo User', 'cashier')`, [passwordHash]);

  // Insert demo till
  db.run(`INSERT OR IGNORE INTO tills (till_name, till_number, location)
          VALUES ('Main Till', 'TILL-001', 'Front Counter')`);

  // Insert demo products
  const products = [
    ['PROD-001', 'Coca Cola 330ml', 'Refreshing soft drink', 'Beverages', 12.99, 8.50, 100],
    ['PROD-002', 'White Bread', 'Fresh baked bread', 'Bakery', 15.50, 10.00, 50],
    ['PROD-003', 'Milk 2L', 'Full cream milk', 'Dairy', 28.99, 22.00, 75],
    ['PROD-004', 'Cheese Slices', 'Cheddar cheese', 'Dairy', 45.99, 35.00, 30],
    ['PROD-005', 'Eggs (6 pack)', 'Free range eggs', 'Dairy', 32.99, 25.00, 40],
    ['PROD-006', 'Apples (1kg)', 'Fresh red apples', 'Produce', 24.99, 18.00, 60],
    ['PROD-007', 'Tomatoes (1kg)', 'Fresh tomatoes', 'Produce', 18.99, 12.00, 45],
    ['PROD-008', 'Potato Chips', 'Crispy chips', 'Snacks', 14.99, 9.00, 80],
    ['PROD-009', 'Chocolate Bar', 'Milk chocolate', 'Snacks', 22.99, 16.00, 120],
    ['PROD-010', 'Coffee 200g', 'Premium ground coffee', 'Beverages', 89.99, 65.00, 25]
  ];

  const stmt = db.prepare(`INSERT OR IGNORE INTO products
    (product_code, product_name, description, category, unit_price, cost_price, stock_quantity)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);

  products.forEach(product => {
    stmt.run(product);
  });

  stmt.finalize();

  console.log('Database initialized successfully!');
  console.log('Demo user created: username=demo, password=demo123');
});

db.close();
