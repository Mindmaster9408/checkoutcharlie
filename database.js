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

// Export query function for PostgreSQL
module.exports = {
  query: (text, params) => pool.query(text, params),
  
  // Add a get method to match SQLite's db.get()
  get: async (sql, params, callback) => {
    try {
      // Convert SQLite ? placeholders to PostgreSQL $1, $2, etc.
      let pgSql = sql;
      if (params && params.length > 0) {
        params.forEach((param, index) => {
          pgSql = pgSql.replace('?', `$${index + 1}`);
        });
      }
      
      const result = await pool.query(pgSql, params);
      callback(null, result.rows[0]);
    } catch (err) {
      callback(err, null);
    }
  }
};
