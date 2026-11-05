// Check if there are any redemptions
require('dotenv').config();
const pool = require('./src/db');

async function checkRedemptions() {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM eco_redemptions');
    console.log(`Total redemptions: ${result.rows[0].count}`);
    
    if (parseInt(result.rows[0].count) > 0) {
      const details = await pool.query(`
        SELECT r.id, r.name, COUNT(er.id) as redemption_count
        FROM eco_rewards r
        LEFT JOIN eco_redemptions er ON er.reward_id = r.id
        GROUP BY r.id, r.name
        HAVING COUNT(er.id) > 0
      `);
      console.log('\nRewards with redemptions:');
      console.table(details.rows);
    } else {
      console.log('✓ No redemptions found - safe to delete all rewards');
    }
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    process.exit(0);
  }
}

checkRedemptions();
