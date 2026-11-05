// =============================================================================
// run-migration.js — Apply a single migration SQL file to the live database.
//
// Usage:
//   node src/db/migrations/run-migration.js <filename>
//
// Example:
//   node src/db/migrations/run-migration.js 001_scan_logs_volume_and_notifications.sql
//
// Requires DATABASE_URL in .env (loaded from project root or DOST-api root).
// =============================================================================

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const pool = require('../../db'); // DOST-api/src/db.js

async function runMigration() {
  const filename = process.argv[2];

  if (!filename) {
    console.error('Usage: node run-migration.js <migration-filename.sql>');
    process.exit(1);
  }

  const migrationPath = path.join(__dirname, filename);

  if (!fs.existsSync(migrationPath)) {
    console.error(`File not found: ${migrationPath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(migrationPath, 'utf8');

  try {
    console.log(`Applying migration: ${filename}`);
    await pool.query(sql);
    console.log(`✓ Migration applied successfully: ${filename}`);
  } catch (err) {
    console.error(`✗ Migration failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

runMigration();
