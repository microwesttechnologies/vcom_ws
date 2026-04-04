const { Pool } = require('pg');
const { databaseUrl } = require('../config/env');

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const pool = new Pool({
  connectionString: databaseUrl,
});

module.exports = pool;
