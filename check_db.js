require('dotenv').config();
const pool = require('./src/db');
(async () => {
  try {
    const cols = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='route_stops' ORDER BY ordinal_position"
    );
    console.log('route_stops cols:', cols.rows.map(r => r.column_name).join(', '));

    const plans = await pool.query(
      'SELECT id, route_id, status, total_bins FROM public.route_plans ORDER BY created_at DESC LIMIT 2'
    );
    console.log('plans:', JSON.stringify(plans.rows, null, 2));

    if (plans.rows.length > 0) {
      const stops = await pool.query(
        'SELECT * FROM public.route_stops WHERE route_vehicle_id IN (SELECT id FROM public.route_vehicles WHERE route_plan_id=$1) LIMIT 3',
        [plans.rows[0].id]
      );
      console.log('sample stop keys:', stops.rows.length > 0 ? Object.keys(stops.rows[0]).join(', ') : 'none');
      if (stops.rows.length > 0) console.log('sample stop:', JSON.stringify(stops.rows[0]));
    }

    const bins = await pool.query(
      'SELECT COUNT(*) AS total FROM public.bins WHERE is_depot=false AND latitude IS NOT NULL'
    );
    console.log('bins with coords:', bins.rows[0].total);
    process.exit(0);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
})();
