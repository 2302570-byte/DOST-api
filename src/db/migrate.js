// =============================================================================
// migrate.js — BE-SMART Database Setup
//
// Runs schema.sql against the configured database.
// Safe to run on a fresh database or re-run on an existing one
// (all statements use CREATE IF NOT EXISTS).
//
// Usage:
//   node src/db/migrate.js
//
// Requires DATABASE_URL in .env
// =============================================================================

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const pool = require('../db');

async function migrate() {
  const sqlPath = path.join(__dirname, 'schema.sql');
  const sql     = fs.readFileSync(sqlPath, 'utf8');

  try {
    await pool.query(sql);
    console.log('✓ Schema applied successfully (schema.sql).');
  } catch (err) {
    console.error('✗ Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();
