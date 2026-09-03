// ─── ECO tables migration ─────────────────────────────────────────────────────
// Runs eco-schema.sql against the database.
//
// Setup order for a FRESH database:
//   1. Run users.sql manually in pgAdmin (creates users table, enum, seed users)
//   2. Run this script: node src/db/migrate.js  (creates ECO tables + seed rewards)
//
// On an existing database that already has the users table, just run this script.

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const pool = require('../db');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'eco-schema.sql'), 'utf8');
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
    await pool.query(sql);
    console.log('ECO schema migration applied successfully.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();
