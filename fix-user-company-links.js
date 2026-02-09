/**
 * ============================================================================
 * Fix User-Company Links
 * ============================================================================
 * This script checks and fixes user-company access records
 * Run this to ensure all users are properly linked to their companies
 * ============================================================================
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : {
    rejectUnauthorized: false
  }
});

async function checkAndFixUserCompanyLinks() {
  const client = await pool.connect();

  try {
    console.log('\n=== Checking User-Company Links ===\n');

    // 1. Find all users
    const usersResult = await client.query(`
      SELECT id, username, full_name, email, role, user_type, is_super_admin
      FROM users
      WHERE is_active = 1
      ORDER BY id
    `);

    console.log(`Found ${usersResult.rows.length} active users\n`);

    // 2. For each user, check their company access
    for (const user of usersResult.rows) {
      console.log(`\n📊 User: ${user.full_name} (${user.username}) [ID: ${user.id}]`);
      console.log(`   Role: ${user.role}, Type: ${user.user_type || 'N/A'}`);

      // Skip super admins
      if (user.is_super_admin === 1) {
        console.log('   ⚠️  Super Admin - No company access needed');
        continue;
      }

      // Check user's company access
      const accessResult = await client.query(`
        SELECT uca.*, c.company_name, c.trading_name
        FROM user_company_access uca
        JOIN companies c ON uca.company_id = c.id
        WHERE uca.user_id = $1
        ORDER BY uca.is_primary DESC, uca.is_active DESC
      `, [user.id]);

      if (accessResult.rows.length === 0) {
        console.log('   ❌ NO COMPANY ACCESS FOUND!');
        
        // Try to find a suitable company
        const companiesResult = await client.query(`
          SELECT id, company_name
          FROM companies
          WHERE is_active = 1
          ORDER BY id
          LIMIT 5
        `);

        if (companiesResult.rows.length > 0) {
          console.log('\n   Available companies:');
          companiesResult.rows.forEach((c, idx) => {
            console.log(`     ${idx + 1}. ${c.company_name} (ID: ${c.id})`);
          });
          console.log('\n   💡 You need to manually link this user to a company using:');
          console.log(`      PUT /api/auth/companies/{companyId}/users/${user.id}`);
          console.log(`      Body: { "role": "${user.role || 'cashier'}", "is_primary": 1 }`);
        }
      } else {
        console.log(`   ✅ Has access to ${accessResult.rows.length} company/companies:`);
        accessResult.rows.forEach((access) => {
          const primaryTag = access.is_primary ? '(PRIMARY)' : '';
          const activeTag = access.is_active ? '✓' : '✗ INACTIVE';
          console.log(`      ${activeTag} ${access.company_name} - Role: ${access.role} ${primaryTag}`);
        });
      }
    }

    // 3. Show all companies
    console.log('\n\n=== All Companies ===\n');
    const companiesResult = await client.query(`
      SELECT c.id, c.company_name, c.trading_name, c.subscription_status,
             COUNT(uca.user_id) as user_count
      FROM companies c
      LEFT JOIN user_company_access uca ON c.id = uca.company_id AND uca.is_active = 1
      WHERE c.is_active = 1
      GROUP BY c.id
      ORDER BY c.id
    `);

    companiesResult.rows.forEach((company) => {
      console.log(`🏢 ${company.company_name} (ID: ${company.id})`);
      console.log(`   Trading: ${company.trading_name || 'N/A'}`);
      console.log(`   Status: ${company.subscription_status || 'N/A'}`);
      console.log(`   Users: ${company.user_count}`);
    });

    console.log('\n\n=== Summary ===\n');
    console.log('✅ Check complete!');
    console.log('\nTo link a user to a company, use the API endpoint:');
    console.log('   PUT /api/auth/companies/{companyId}/users/{userId}');
    console.log('   Headers: { "Authorization": "Bearer {your-token}" }');
    console.log('   Body: { "role": "business_owner", "is_primary": 1 }');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the check
checkAndFixUserCompanyLinks().catch(console.error);
