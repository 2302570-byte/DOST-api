// Run a single migration file against the database.
// Usage: node src/db/migrations/run-migration.js <filename>
// Example: node src/db/migrations/run-migration.js 004_bin_scan_rewards.sql

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node run-migration.js <filename.sql>');
    process.exit(1);
  }
  const sqlPath = path.join(__dirname, file);
  if (!fs.existsSync(sqlPath)) {
    console.error(`File not found: ${sqlPath}`);
    process.exit(1);
  }
  const sql = fs.readFileSync(sqlPath, 'utf8');
  try {
    await pool.query(sql);
    console.log(`✓ Migration applied: ${file}`);
  } catch (err) {
    console.error(`✗ Migration failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
