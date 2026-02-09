/**
 * ============================================================================
 * Phase 1 Database Migration Script
 * ============================================================================
 * Run this script to apply all Phase 1 database changes:
 * 1. Clean up duplicate companies (Bug #1)
 * 2. Create forensic audit_log table
 * 3. Create sale_payments table (multi-payment)
 * 4. Add customer management columns (loyalty, credit)
 * 5. Add receipt delivery tracking
 * 6. Fix user-company links (Bug #2)
 * 
 * Usage: node migrate-phase1.js
 * ============================================================================
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function migrate() {
  const client = await pool.connect();
  
  try {
    console.log('\n🚀 Starting Phase 1 Migration...\n');

    // ========== BUG #1: Clean up duplicate companies ==========
    console.log('1️⃣  Cleaning up duplicate companies...');
    
    // Find duplicate "Default Company" entries
    const dupes = await client.query(`
      SELECT id, company_name, created_at 
      FROM companies 
      WHERE company_name = 'Default Company' 
      ORDER BY id ASC
    `);
    
    if (dupes.rows.length > 1) {
      const keepId = dupes.rows[0].id; // Keep the first one
      const removeIds = dupes.rows.slice(1).map(r => r.id);
      
      console.log(`   Found ${dupes.rows.length} "Default Company" entries.`);
      console.log(`   Keeping ID ${keepId}, removing IDs: ${removeIds.join(', ')}`);
      
      // Migrate orphaned data to the first company
      for (const removeId of removeIds) {
        await client.query(`UPDATE products SET company_id = $1 WHERE company_id = $2`, [keepId, removeId]);
        await client.query(`UPDATE sales SET company_id = $1 WHERE company_id = $2`, [keepId, removeId]);
        await client.query(`UPDATE sale_items SET company_id = $1 WHERE company_id = $2`, [keepId, removeId]);
        await client.query(`UPDATE tills SET company_id = $1 WHERE company_id = $2`, [keepId, removeId]);
        await client.query(`UPDATE till_sessions SET company_id = $1 WHERE company_id = $2`, [keepId, removeId]);
        await client.query(`UPDATE customers SET company_id = $1 WHERE company_id = $2`, [keepId, removeId]);
        await client.query(`UPDATE user_company_access SET company_id = $1 WHERE company_id = $2`, [keepId, removeId]);
        
        // Delete the duplicate
        await client.query(`DELETE FROM companies WHERE id = $1`, [removeId]);
      }
      
      console.log(`   ✅ Cleaned up ${removeIds.length} duplicate companies\n`);
    } else {
      console.log('   ✅ No duplicate companies found\n');
    }

    // ========== FORENSIC AUDIT LOG TABLE ==========
    console.log('2️⃣  Creating forensic audit_log table...');
    
    await client.query(`CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      company_id INTEGER,
      user_id INTEGER,
      user_email VARCHAR(255) NOT NULL DEFAULT 'system',
      action_type VARCHAR(50) NOT NULL,
      entity_type VARCHAR(50) NOT NULL,
      entity_id VARCHAR(100),
      field_name VARCHAR(100),
      old_value TEXT,
      new_value TEXT,
      ip_address VARCHAR(50),
      session_id VARCHAR(255),
      user_agent TEXT,
      additional_metadata TEXT DEFAULT '{}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Create indexes for performance
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_company ON audit_log(company_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action_type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(created_at DESC)`);
    
    console.log('   ✅ audit_log table ready\n');

    // ========== SALE PAYMENTS TABLE (Multi-payment) ==========
    console.log('3️⃣  Creating sale_payments table...');
    
    await client.query(`CREATE TABLE IF NOT EXISTS sale_payments (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER NOT NULL,
      company_id INTEGER,
      payment_method VARCHAR(50) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      reference VARCHAR(255),
      status VARCHAR(50) DEFAULT 'completed',
      processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      processed_by INTEGER,
      metadata TEXT DEFAULT '{}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_sale_payments_sale ON sale_payments(sale_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sale_payments_company ON sale_payments(company_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sale_payments_method ON sale_payments(payment_method)`);
    
    // Add new columns to sales table
    await client.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'completed'`);
    await client.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_complete INTEGER DEFAULT 1`);
    await client.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP`);
    await client.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS voided_by INTEGER`);
    await client.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS void_reason TEXT`);
    await client.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) DEFAULT 0`);
    await client.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS discount_reason TEXT`);
    await client.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS receipt_number VARCHAR(50)`);
    await client.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS receipt_email_sent INTEGER DEFAULT 0`);
    await client.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS receipt_sms_sent INTEGER DEFAULT 0`);
    
    console.log('   ✅ sale_payments table ready\n');

    // ========== CUSTOMER MANAGEMENT UPGRADES ==========
    console.log('4️⃣  Upgrading customers table...');
    
    // Add loyalty and credit columns to existing customers table
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_number VARCHAR(50)`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS first_name VARCHAR(100)`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_name VARCHAR(100)`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone VARCHAR(50)`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS date_of_birth DATE`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS id_number VARCHAR(50)`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_group VARCHAR(50) DEFAULT 'retail'`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_limit DECIMAL(10,2) DEFAULT 0`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS current_balance DECIMAL(10,2) DEFAULT 0`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_points INTEGER DEFAULT 0`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_tier VARCHAR(50) DEFAULT 'bronze'`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS marketing_consent INTEGER DEFAULT 0`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes TEXT`);

    // Customer group pricing
    await client.query(`CREATE TABLE IF NOT EXISTS customer_group_pricing (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      customer_group VARCHAR(50) NOT NULL,
      product_id INTEGER NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_group_pricing_company ON customer_group_pricing(company_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_group_pricing_group ON customer_group_pricing(customer_group)`);

    // Loyalty transactions
    await client.query(`CREATE TABLE IF NOT EXISTS loyalty_point_transactions (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL,
      points_change INTEGER NOT NULL,
      transaction_type VARCHAR(50) NOT NULL,
      description TEXT,
      sale_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_loyalty_pt_customer ON loyalty_point_transactions(customer_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_loyalty_pt_company ON loyalty_point_transactions(company_id)`);

    // Customer account transactions (credit accounts)
    await client.query(`CREATE TABLE IF NOT EXISTS customer_account_transactions (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL,
      transaction_type VARCHAR(50) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      balance_after DECIMAL(10,2) NOT NULL,
      sale_id INTEGER,
      payment_id INTEGER,
      due_date DATE,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_account_trans_customer ON customer_account_transactions(customer_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_account_trans_company ON customer_account_transactions(company_id)`);

    console.log('   ✅ Customer tables upgraded\n');

    // ========== RECEIPT DELIVERY TRACKING ==========
    console.log('5️⃣  Creating receipt delivery tracking...');
    
    await client.query(`CREATE TABLE IF NOT EXISTS receipt_deliveries (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER NOT NULL,
      company_id INTEGER,
      delivery_method VARCHAR(50) NOT NULL,
      recipient VARCHAR(255),
      status VARCHAR(50) DEFAULT 'pending',
      delivered_at TIMESTAMP,
      error_message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_receipt_deliveries_sale ON receipt_deliveries(sale_id)`);
    
    console.log('   ✅ Receipt delivery tracking ready\n');

    // ========== BUG #2: Fix user-company links ==========
    console.log('6️⃣  Checking user-company links...');
    
    // Find users without company access (excluding super admins)
    const orphanedUsers = await client.query(`
      SELECT u.id, u.username, u.full_name, u.role
      FROM users u
      WHERE u.is_active = 1
        AND u.is_super_admin = 0
        AND u.id NOT IN (
          SELECT DISTINCT user_id FROM user_company_access WHERE is_active = 1
        )
    `);

    if (orphanedUsers.rows.length > 0) {
      console.log(`   ⚠️  Found ${orphanedUsers.rows.length} users without company access:`);
      
      // Get the first active company to link them to
      const firstCompany = await client.query(`
        SELECT id, company_name FROM companies WHERE is_active = 1 ORDER BY id LIMIT 1
      `);
      
      if (firstCompany.rows.length > 0) {
        const companyId = firstCompany.rows[0].id;
        console.log(`   Auto-linking to "${firstCompany.rows[0].company_name}" (ID: ${companyId}):`);
        
        for (const user of orphanedUsers.rows) {
          await client.query(`
            INSERT INTO user_company_access (user_id, company_id, role, is_primary, is_active)
            VALUES ($1, $2, $3, 1, 1)
            ON CONFLICT (user_id, company_id) DO UPDATE SET is_active = 1
          `, [user.id, companyId, user.role || 'cashier']);
          
          console.log(`      ✅ Linked ${user.full_name} (${user.username}) as ${user.role || 'cashier'}`);
        }
      } else {
        console.log('   ⚠️  No active companies found to link users to');
      }
    } else {
      console.log('   ✅ All users have company access\n');
    }

    // ========== MIGRATE NULL COMPANY DATA ==========
    console.log('7️⃣  Migrating orphaned data...');
    
    const firstCompanyResult = await client.query(`SELECT id FROM companies WHERE is_active = 1 ORDER BY id LIMIT 1`);
    if (firstCompanyResult.rows.length > 0) {
      const cid = firstCompanyResult.rows[0].id;
      
      const tables = ['products', 'sales', 'sale_items', 'tills', 'till_sessions', 'customers'];
      for (const table of tables) {
        const result = await client.query(`UPDATE ${table} SET company_id = $1 WHERE company_id IS NULL`, [cid]);
        if (result.rowCount > 0) {
          console.log(`   ✅ Fixed ${result.rowCount} rows in ${table}`);
        }
      }
    }

    console.log('\n✅ Phase 1 Migration Complete!\n');
    console.log('Summary:');
    console.log('  - Duplicate companies cleaned up');
    console.log('  - Forensic audit_log table created');
    console.log('  - Multi-payment (sale_payments) table created');
    console.log('  - Customer management upgraded (loyalty, credit)');
    console.log('  - Receipt delivery tracking created');
    console.log('  - User-company links fixed');
    console.log('  - Orphaned data migrated\n');

  } catch (err) {
    console.error('❌ Migration error:', err.message);
    console.error(err.stack);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
