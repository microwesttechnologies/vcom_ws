const fs = require('fs');
const path = require('path');
const pool = require('./pool');

async function runMigration() {
  const schemaPath = path.resolve(__dirname, '../../db/schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
  console.log('Database migration completed');
}

module.exports = {
  runMigration,
};

if (require.main === module) {
  runMigration()
    .then(() => pool.end())
    .catch((error) => {
      console.error('Migration failed:', error);
      pool.end().finally(() => process.exit(1));
    });
}
