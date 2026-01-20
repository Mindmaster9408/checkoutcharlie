/**
 * ============================================================================
 * ⚠️  CRITICAL FILE - DO NOT MODIFY WITHOUT CAREFUL CONSIDERATION  ⚠️
 * ============================================================================
 * This file handles the PostgreSQL database connection for Zeabur deployment.
 * Changes here can break the entire application login and database access.
 *
 * Last stable version: v1.0-stable-auth
 * To restore: git checkout v1.0-stable-auth -- database.js
 * ============================================================================
 */

const { Pool } = require('pg');

// Zeabur internal PostgreSQL doesn't need SSL
const poolConfig = {
  connectionString: process.env.DATABASE_URL
};

// Only add SSL for external databases (not Zeabur internal)
if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('neon.tech')) {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

// Helper function to convert SQLite ? placeholders to PostgreSQL $1, $2, etc.
function convertPlaceholders(sql, params) {
  let pgSql = sql;
  let index = 1;
  while (pgSql.includes('?')) {
    pgSql = pgSql.replace('?', `$${index}`);
    index++;
  }
  return pgSql;
}

// Export query function for PostgreSQL
module.exports = {
  query: (text, params) => pool.query(text, params),

  // Add a get method to match SQLite's db.get()
  get: async (sql, params, callback) => {
    try {
      const pgSql = convertPlaceholders(sql, params);
      const result = await pool.query(pgSql, params);
      callback(null, result.rows[0]);
    } catch (err) {
      callback(err, null);
    }
  },

  // Add an all method to match SQLite's db.all()
  all: async (sql, params, callback) => {
    try {
      const pgSql = convertPlaceholders(sql, params);
      const result = await pool.query(pgSql, params);
      callback(null, result.rows);
    } catch (err) {
      callback(err, null);
    }
  },

  // Add a run method to match SQLite's db.run()
  run: async function(sql, params, callback) {
    try {
      const pgSql = convertPlaceholders(sql, params);
      // For INSERT statements, add RETURNING id to get lastID
      let finalSql = pgSql;
      if (sql.trim().toUpperCase().startsWith('INSERT') && !pgSql.toUpperCase().includes('RETURNING')) {
        finalSql = pgSql + ' RETURNING id';
      }
      const result = await pool.query(finalSql, params);
      // Create a context object with lastID for INSERT operations
      const context = {
        lastID: result.rows && result.rows[0] ? result.rows[0].id : null,
        changes: result.rowCount
      };
      if (callback) {
        callback.call(context, null);
      }
    } catch (err) {
      if (callback) {
        callback.call({}, err);
      }
    }
  },

  // Add prepare method to match SQLite's db.prepare() - simplified version
  prepare: (sql) => {
    const pgSql = convertPlaceholders(sql, []);
    return {
      run: async (...params) => {
        try {
          await pool.query(pgSql, params);
        } catch (err) {
          console.error('Prepared statement error:', err);
        }
      },
      finalize: () => {} // No-op for PostgreSQL
    };
  }
};
