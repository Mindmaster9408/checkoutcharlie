const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const posRoutes = require('./routes/pos');
const seanAiRoutes = require('./routes/sean-ai');
const auditRoutes = require('./routes/audit');
const vatRoutes = require('./routes/vat');
const barcodeRoutes = require('./routes/barcode');
const customersRoutes = require('./routes/customers');
const reportsRoutes = require('./routes/reports');

const app = express();
const PORT = process.env.PORT || 8080;

/**
 * ============================================================================
 * ⚠️  CRITICAL SECTION - DO NOT MODIFY WITHOUT CAREFUL CONSIDERATION  ⚠️
 * ============================================================================
 * The initDatabase() function below handles PostgreSQL setup for Zeabur.
 * Modifying this can break the entire application.
 *
 * Last stable version: v1.0-stable-auth
 * To restore: git checkout v1.0-stable-auth -- server.js
 * ============================================================================
 */

// Auto-initialize database on startup
async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    console.log('No DATABASE_URL found, skipping PostgreSQL init');
    return;
  }

  // Zeabur internal PostgreSQL doesn't need SSL
  const poolConfig = {
    connectionString: process.env.DATABASE_URL
  };

  const pool = new Pool(poolConfig);

  try {
    console.log('Checking/initializing PostgreSQL database...');

    // Users table
    await pool.query(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      full_name VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tills table
    await pool.query(`CREATE TABLE IF NOT EXISTS tills (
      id SERIAL PRIMARY KEY,
      till_name VARCHAR(255) UNIQUE NOT NULL,
      till_number VARCHAR(50) UNIQUE NOT NULL,
      location VARCHAR(255),
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Till Sessions table
    await pool.query(`CREATE TABLE IF NOT EXISTS till_sessions (
      id SERIAL PRIMARY KEY,
      till_id INTEGER NOT NULL REFERENCES tills(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      opening_balance DECIMAL(10,2) NOT NULL,
      closing_balance DECIMAL(10,2),
      expected_balance DECIMAL(10,2),
      variance DECIMAL(10,2),
      status VARCHAR(20) DEFAULT 'open',
      opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      closed_at TIMESTAMP,
      notes TEXT
    )`);

    // Products table
    await pool.query(`CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      product_code VARCHAR(50) UNIQUE NOT NULL,
      product_name VARCHAR(255) NOT NULL,
      description TEXT,
      category VARCHAR(100),
      unit_price DECIMAL(10,2) NOT NULL,
      cost_price DECIMAL(10,2),
      stock_quantity INTEGER DEFAULT 0,
      min_stock_level INTEGER DEFAULT 10,
      is_active INTEGER DEFAULT 1,
      barcode VARCHAR(100),
      requires_vat INTEGER DEFAULT 1,
      vat_rate DECIMAL(5,2) DEFAULT 15,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Add missing columns if they don't exist (for existing tables)
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode VARCHAR(100)`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS requires_vat INTEGER DEFAULT 1`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS vat_rate DECIMAL(5,2) DEFAULT 15`);

    // Sales table
    await pool.query(`CREATE TABLE IF NOT EXISTS sales (
      id SERIAL PRIMARY KEY,
      sale_number VARCHAR(50) UNIQUE NOT NULL,
      till_session_id INTEGER NOT NULL REFERENCES till_sessions(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      subtotal DECIMAL(10,2) NOT NULL,
      vat_amount DECIMAL(10,2) NOT NULL,
      total_amount DECIMAL(10,2) NOT NULL,
      payment_method VARCHAR(50) NOT NULL,
      status VARCHAR(20) DEFAULT 'completed',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Sale Items table
    await pool.query(`CREATE TABLE IF NOT EXISTS sale_items (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER NOT NULL REFERENCES sales(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL,
      unit_price DECIMAL(10,2) NOT NULL,
      total_price DECIMAL(10,2) NOT NULL
    )`);

    // Customers table
    await pool.query(`CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      contact_person VARCHAR(255),
      contact_number VARCHAR(50),
      email VARCHAR(255),
      address_line_1 VARCHAR(255),
      address_line_2 VARCHAR(255),
      suburb VARCHAR(100),
      city VARCHAR(100),
      province VARCHAR(100),
      postal_code VARCHAR(20),
      tax_reference VARCHAR(50),
      company VARCHAR(255),
      customer_type VARCHAR(50) DEFAULT 'Cash Sale Customer',
      custom_field TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Insert demo user if not exists
    const passwordHash = bcrypt.hashSync('demo123', 10);
    await pool.query(`
      INSERT INTO users (username, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (username) DO NOTHING
    `, ['demo', passwordHash, 'Demo User', 'cashier']);

    // Insert demo till if not exists
    await pool.query(`
      INSERT INTO tills (till_name, till_number, location)
      VALUES ($1, $2, $3)
      ON CONFLICT (till_name) DO NOTHING
    `, ['Main Till', 'TILL-001', 'Front Counter']);

    console.log('✅ Database initialized successfully');
    await pool.end();
  } catch (err) {
    console.error('Database init error:', err.message);
  }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('POS_App'));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/pos', posRoutes);
app.use('/api/sean', seanAiRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/vat', vatRoutes);
app.use('/api/barcode', barcodeRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/reports', reportsRoutes);

// Serve the main POS application
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'POS_App', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Initialize database then start server
initDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`POS System Server running on port ${PORT}`);
    console.log(`API available at /api`);
  });
});
