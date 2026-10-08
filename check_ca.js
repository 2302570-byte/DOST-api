require('dotenv').config();
const pool = require('./src/db');

(async () => {
  try {
    // Check what /routing/routes?limit=1 returns
    const { rows: plans } = await pool.query(
      `SELECT id, route_id, status, total_bins FROM public.route_plans ORDER BY created_at DESC LIMIT 1`
    );
    console.log('Latest plan:', JSON.stringify(plans[0] ?? null));

    if (plans.length > 0) {
      // Check vehicles
      const { rows: vehicles } = await pool.query(
        `SELECT id, truck_name, route_color, vehicle_index FROM route_vehicles WHERE route_plan_id = $1`,
        [plans[0].id]
      );
      console.log('Vehicles:', JSON.stringify(vehicles));

      if (vehicles.length > 0) {
        const { rows: stops } = await pool.query(
          `SELECT stop_order, bin_name, bin_latitude::float, bin_longitude::float, is_depot
           FROM route_stops WHERE route_vehicle_id = $1 ORDER BY stop_order LIMIT 10`,
          [vehicles[0].id]
        );
        console.log('First vehicle stops sample:', JSON.stringify(stops));
      }
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
  pool.end();
})();
