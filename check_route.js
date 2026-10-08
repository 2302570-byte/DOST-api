require('dotenv').config();
const pool = require('./src/db');

(async () => {
  try {
    // Check live-route bins
    const { rows: bins } = await pool.query(
      "SELECT name, is_depot, latitude::float, longitude::float, status FROM public.bins WHERE is_depot=true OR status='FULL' ORDER BY is_depot DESC LIMIT 10"
    );
    console.log('\n=== FULL/Depot bins ===');
    bins.forEach(b => console.log(JSON.stringify(b)));

    // Check saved route plans
    const { rows: plans } = await pool.query(
      'SELECT id, route_id, status, total_bins, created_at FROM public.route_plans ORDER BY created_at DESC LIMIT 3'
    );
    console.log('\n=== Route Plans ===');
    plans.forEach(p => console.log(JSON.stringify(p)));

    if (plans.length > 0) {
      const { rows: vstops } = await pool.query(
        `SELECT rv.vehicle_index, rs.stop_order, rs.bin_name,
                rs.bin_latitude::float AS lat,
                rs.bin_longitude::float AS lng,
                rs.is_depot
         FROM route_vehicles rv
         JOIN route_stops rs ON rs.route_vehicle_id = rv.id
         WHERE rv.route_plan_id = $1
         ORDER BY rv.vehicle_index, rs.stop_order
         LIMIT 25`,
        [plans[0].id]
      );
      console.log('\n=== Latest Plan Stops ===');
      vstops.forEach(s => console.log(JSON.stringify(s)));
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
  pool.end();
})();
