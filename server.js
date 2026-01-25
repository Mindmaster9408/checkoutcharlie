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

    // ========== MULTI-TENANT TABLES ==========

    // Companies table (core tenant entity)
    await pool.query(`CREATE TABLE IF NOT EXISTS companies (
      id SERIAL PRIMARY KEY,
      company_name VARCHAR(255) NOT NULL,
      trading_name VARCHAR(255),
      registration_number VARCHAR(100),
      vat_number VARCHAR(50),
      contact_email VARCHAR(255),
      contact_phone VARCHAR(50),
      address TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Accounting Firms table
    await pool.query(`CREATE TABLE IF NOT EXISTS accounting_firms (
      id SERIAL PRIMARY KEY,
      firm_name VARCHAR(255) NOT NULL,
      registration_number VARCHAR(100),
      contact_email VARCHAR(255),
      contact_phone VARCHAR(50),
      address TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Users table (updated for multi-tenant)
    await pool.query(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      email VARCHAR(255),
      password_hash VARCHAR(255) NOT NULL,
      full_name VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL,
      user_type VARCHAR(50) DEFAULT 'company_user',
      accounting_firm_id INTEGER,
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Add new columns to users table if they don't exist
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255)`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS user_type VARCHAR(50) DEFAULT 'company_user'`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS accounting_firm_id INTEGER`);

    // Firm-Company Access (links accounting firms to companies they manage)
    await pool.query(`CREATE TABLE IF NOT EXISTS firm_company_access (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL,
      granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      granted_by_user_id INTEGER,
      is_active INTEGER DEFAULT 1,
      UNIQUE(firm_id, company_id)
    )`);

    // User-Company Access (links users to companies with specific roles)
    await pool.query(`CREATE TABLE IF NOT EXISTS user_company_access (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL,
      role VARCHAR(50) NOT NULL,
      is_primary INTEGER DEFAULT 0,
      granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      granted_by_user_id INTEGER,
      is_active INTEGER DEFAULT 1,
      UNIQUE(user_id, company_id)
    )`);

    // Invitations table (for email invites)
    await pool.query(`CREATE TABLE IF NOT EXISTS invitations (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      company_id INTEGER NOT NULL,
      invitation_type VARCHAR(50) NOT NULL,
      token VARCHAR(255) UNIQUE NOT NULL,
      invited_by_user_id INTEGER,
      accepted_at TIMESTAMP,
      accepted_by_user_id INTEGER,
      expires_at TIMESTAMP NOT NULL,
      is_used INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // ========== EXISTING TABLES ==========

    // Tills table
    await pool.query(`CREATE TABLE IF NOT EXISTS tills (
      id SERIAL PRIMARY KEY,
      company_id INTEGER,
      till_name VARCHAR(255) NOT NULL,
      till_number VARCHAR(50) NOT NULL,
      location VARCHAR(255),
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(company_id, till_name),
      UNIQUE(company_id, till_number)
    )`);
    await pool.query(`ALTER TABLE tills ADD COLUMN IF NOT EXISTS company_id INTEGER`);

    // Till Sessions table
    await pool.query(`CREATE TABLE IF NOT EXISTS till_sessions (
      id SERIAL PRIMARY KEY,
      company_id INTEGER,
      till_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      opening_balance DECIMAL(10,2) NOT NULL,
      closing_balance DECIMAL(10,2),
      expected_balance DECIMAL(10,2),
      variance DECIMAL(10,2),
      status VARCHAR(20) DEFAULT 'open',
      opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      closed_at TIMESTAMP,
      notes TEXT
    )`);
    await pool.query(`ALTER TABLE till_sessions ADD COLUMN IF NOT EXISTS company_id INTEGER`);

    // Products table
    await pool.query(`CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      company_id INTEGER,
      product_code VARCHAR(50) NOT NULL,
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
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(company_id, product_code)
    )`);

    // Add missing columns if they don't exist (for existing tables)
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS company_id INTEGER`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode VARCHAR(100)`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS requires_vat INTEGER DEFAULT 1`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS vat_rate DECIMAL(5,2) DEFAULT 15`);

    // Sales table
    await pool.query(`CREATE TABLE IF NOT EXISTS sales (
      id SERIAL PRIMARY KEY,
      company_id INTEGER,
      sale_number VARCHAR(50) NOT NULL,
      till_session_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      customer_id INTEGER,
      subtotal DECIMAL(10,2) NOT NULL,
      vat_amount DECIMAL(10,2) NOT NULL,
      total_amount DECIMAL(10,2) NOT NULL,
      payment_method VARCHAR(50) NOT NULL,
      status VARCHAR(20) DEFAULT 'completed',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(company_id, sale_number)
    )`);
    await pool.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS company_id INTEGER`);
    await pool.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_id INTEGER`);

    // Sale Items table
    await pool.query(`CREATE TABLE IF NOT EXISTS sale_items (
      id SERIAL PRIMARY KEY,
      company_id INTEGER,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price DECIMAL(10,2) NOT NULL,
      total_price DECIMAL(10,2) NOT NULL
    )`);
    await pool.query(`ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS company_id INTEGER`);

    // Customers table
    await pool.query(`CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      company_id INTEGER,
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
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_id INTEGER`);

    // ========== MIGRATION: Create default company for existing data ==========

    // Create default company if not exists
    const companyResult = await pool.query(`
      INSERT INTO companies (company_name, trading_name)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
      RETURNING id
    `, ['Default Company', 'Default Company']);

    // Get the default company ID
    let defaultCompanyId = 1;
    const existingCompany = await pool.query(`SELECT id FROM companies WHERE company_name = 'Default Company'`);
    if (existingCompany.rows.length > 0) {
      defaultCompanyId = existingCompany.rows[0].id;
    }

    // Migrate existing data to default company
    await pool.query(`UPDATE tills SET company_id = $1 WHERE company_id IS NULL`, [defaultCompanyId]);
    await pool.query(`UPDATE products SET company_id = $1 WHERE company_id IS NULL`, [defaultCompanyId]);
    await pool.query(`UPDATE customers SET company_id = $1 WHERE company_id IS NULL`, [defaultCompanyId]);
    await pool.query(`UPDATE till_sessions SET company_id = $1 WHERE company_id IS NULL`, [defaultCompanyId]);
    await pool.query(`UPDATE sales SET company_id = $1 WHERE company_id IS NULL`, [defaultCompanyId]);
    await pool.query(`UPDATE sale_items SET company_id = $1 WHERE company_id IS NULL`, [defaultCompanyId]);

    // Insert demo user if not exists (as business_owner)
    const passwordHash = bcrypt.hashSync('demo123', 10);
    await pool.query(`
      INSERT INTO users (username, password_hash, full_name, role, user_type)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (username) DO NOTHING
    `, ['demo', passwordHash, 'Demo User', 'business_owner', 'business_owner']);

    // Update existing demo user to business_owner if they exist
    await pool.query(`
      UPDATE users SET role = 'business_owner', user_type = 'business_owner'
      WHERE username = 'demo' AND user_type IS NULL OR user_type = 'company_user'
    `);

    // Get demo user ID
    const demoUserResult = await pool.query(`SELECT id FROM users WHERE username = 'demo'`);
    if (demoUserResult.rows.length > 0) {
      const demoUserId = demoUserResult.rows[0].id;

      // Link demo user to default company
      await pool.query(`
        INSERT INTO user_company_access (user_id, company_id, role, is_primary)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, company_id) DO NOTHING
      `, [demoUserId, defaultCompanyId, 'business_owner', 1]);
    }

    // Insert demo till if not exists
    await pool.query(`
      INSERT INTO tills (company_id, till_name, till_number, location)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT DO NOTHING
    `, [defaultCompanyId, 'Main Till', 'TILL-001', 'Front Counter']);

    // ========== BARCODE TABLES ==========

    // Barcode Settings table
    await pool.query(`CREATE TABLE IF NOT EXISTS barcode_settings (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      company_prefix VARCHAR(10) DEFAULT '600',
      current_sequence INTEGER DEFAULT 1000,
      barcode_type VARCHAR(20) DEFAULT 'EAN13',
      auto_generate INTEGER DEFAULT 0,
      last_generated VARCHAR(50),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_by_user_id INTEGER,
      UNIQUE(company_id)
    )`);

    // Barcode History table
    await pool.query(`CREATE TABLE IF NOT EXISTS barcode_history (
      id SERIAL PRIMARY KEY,
      company_id INTEGER,
      barcode VARCHAR(100) NOT NULL,
      barcode_type VARCHAR(20),
      product_id INTEGER,
      is_company_generated INTEGER DEFAULT 0,
      assigned_by_user_id INTEGER,
      assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // ========== SEAN AI TABLES ==========

    // Sean AI Product Knowledge table
    await pool.query(`CREATE TABLE IF NOT EXISTS sean_product_knowledge (
      id SERIAL PRIMARY KEY,
      barcode VARCHAR(100) UNIQUE,
      product_name VARCHAR(255),
      category VARCHAR(100),
      unit_of_measure VARCHAR(50),
      requires_vat INTEGER DEFAULT 1,
      vat_rate DECIMAL(5,2) DEFAULT 15,
      confidence_score DECIMAL(3,2) DEFAULT 0.5,
      times_seen INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // ========== AUDIT & SETTINGS TABLES ==========

    // Audit Trail table
    await pool.query(`CREATE TABLE IF NOT EXISTS audit_trail (
      id SERIAL PRIMARY KEY,
      company_id INTEGER,
      user_id INTEGER,
      event_type VARCHAR(100) NOT NULL,
      event_category VARCHAR(50),
      event_data TEXT,
      ip_address VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // VAT Settings table
    await pool.query(`CREATE TABLE IF NOT EXISTS vat_settings (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      is_vat_registered INTEGER DEFAULT 0,
      vat_number VARCHAR(50),
      vat_rate DECIMAL(5,2) DEFAULT 15,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_by_user_id INTEGER,
      UNIQUE(company_id)
    )`);

    // Company Settings table (for float amount, printer settings, etc.)
    await pool.query(`CREATE TABLE IF NOT EXISTS company_settings (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      till_float_amount DECIMAL(10,2) DEFAULT 0,
      receipt_printer_name VARCHAR(255),
      receipt_printer_ip VARCHAR(50),
      receipt_printer_port INTEGER,
      auto_print_receipt INTEGER DEFAULT 1,
      receipt_header TEXT,
      receipt_footer TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_by_user_id INTEGER,
      UNIQUE(company_id)
    )`);

    // ========== STOCK MANAGEMENT TABLES ==========

    // Stock Adjustments table
    await pool.query(`CREATE TABLE IF NOT EXISTS stock_adjustments (
      id SERIAL PRIMARY KEY,
      company_id INTEGER,
      product_id INTEGER NOT NULL,
      adjustment_type VARCHAR(50) NOT NULL,
      quantity_change INTEGER NOT NULL,
      quantity_before INTEGER,
      quantity_after INTEGER,
      reason TEXT,
      reference_number VARCHAR(100),
      adjusted_by_user_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // ========== DAILY DISCOUNT TABLES ==========

    // Product Daily Discounts table
    await pool.query(`CREATE TABLE IF NOT EXISTS product_daily_discounts (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      discount_price DECIMAL(10,2) NOT NULL,
      original_price DECIMAL(10,2) NOT NULL,
      reason TEXT,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      created_by_user_id INTEGER,
      approved_by_user_id INTEGER,
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // ========== PRICE OVERRIDE TABLES ==========

    // Price Override Authorization table
    await pool.query(`CREATE TABLE IF NOT EXISTS price_overrides (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      sale_id INTEGER,
      product_id INTEGER,
      original_price DECIMAL(10,2) NOT NULL,
      override_price DECIMAL(10,2) NOT NULL,
      reason TEXT,
      authorized_by_user_id INTEGER NOT NULL,
      cashier_user_id INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // ========== SALE RETURNS TABLES ==========

    // Sale Returns table
    await pool.query(`CREATE TABLE IF NOT EXISTS sale_returns (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      original_sale_id INTEGER NOT NULL,
      return_number VARCHAR(50) NOT NULL,
      total_refund DECIMAL(10,2) NOT NULL,
      reason TEXT,
      processed_by_user_id INTEGER NOT NULL,
      authorized_by_user_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(company_id, return_number)
    )`);

    // Sale Return Items table
    await pool.query(`CREATE TABLE IF NOT EXISTS sale_return_items (
      id SERIAL PRIMARY KEY,
      return_id INTEGER NOT NULL,
      sale_item_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity_returned INTEGER NOT NULL,
      refund_amount DECIMAL(10,2) NOT NULL
    )`);

    // ========== RECEIPT PRINTERS TABLE ==========

    // Receipt Printers table
    await pool.query(`CREATE TABLE IF NOT EXISTS receipt_printers (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      printer_name VARCHAR(255) NOT NULL,
      printer_type VARCHAR(50) DEFAULT 'network',
      ip_address VARCHAR(50),
      port INTEGER DEFAULT 9100,
      is_default INTEGER DEFAULT 0,
      paper_width INTEGER DEFAULT 80,
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // ========== DAILY TILL RESET TABLE ==========

    // Daily Till Resets table
    await pool.query(`CREATE TABLE IF NOT EXISTS daily_till_resets (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      till_id INTEGER NOT NULL,
      reset_date DATE NOT NULL,
      session_id_before INTEGER,
      reset_by_user_id INTEGER NOT NULL,
      opening_float DECIMAL(10,2),
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Create default barcode settings for default company
    await pool.query(`
      INSERT INTO barcode_settings (company_id, company_prefix, current_sequence, barcode_type)
      VALUES ($1, '600', 1000, 'EAN13')
      ON CONFLICT (company_id) DO NOTHING
    `, [defaultCompanyId]);

    // Create default company settings for default company
    await pool.query(`
      INSERT INTO company_settings (company_id, till_float_amount)
      VALUES ($1, 500.00)
      ON CONFLICT (company_id) DO NOTHING
    `, [defaultCompanyId]);

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
