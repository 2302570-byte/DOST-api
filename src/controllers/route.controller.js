/**
 * route.controller.js — BE-SMART CVRP-TW Route Optimizer
 * ========================================================
 * Solves the Capacitated Vehicle Routing Problem with Time Windows (CVRP-TW)
 * using:
 *   1. Mapbox Directions Matrix API  — real-world travel time matrix
 *   2. Google OR-Tools (Python)      — PATH_CHEAPEST_ARC + GUIDED_LOCAL_SEARCH
 *   3. PostgreSQL                    — persist full route plan for history
 *
 * Each truck's effective capacity = max_capacity × (1 - CAPACITY_MARGIN)
 * This provides a safety buffer so bins don't overflow in edge cases.
 */

'use strict';

const { spawn }   = require('child_process');
const path        = require('path');
const pool        = require('../db');

// ── Constants ─────────────────────────────────────────────────────────────────
const CAPACITY_MARGIN   = 0.05;   // 5% safety margin on each truck's max_capacity
const SHIFT_START_SEC   = 0;      // seconds from 07:00 (shift start)
const SHIFT_END_SEC     = 11 * 60 * 60; // 11-hour shift (07:00–18:00)
const AVG_SPEED_KMH     = 30;     // Batangas City urban driving average for distance estimate
const MAX_MATRIX_COORDS = 25;     // Mapbox Matrix API hard limit per request

// ── Truck cost profiles (Heterogeneous Fleet) ─────────────────────────────────
// Fixed deployment cost (₱) — paid once if the vehicle is dispatched at all.
// Variable fuel cost (₱ per second of travel time).
// Larger trucks have higher fixed costs → OR-Tools avoids them for small loads.
const TRUCK_COST_PROFILE = {
  '10_wheeler':      { fixed: 1500, fuel_per_sec: 30 / 3600 },  // ₱30/km ÷ 30km/h
  'forward_truck':   { fixed:  800, fuel_per_sec: 20 / 3600 },  // ₱20/km
  'mini_dump_truck': { fixed:  500, fuel_per_sec: 12 / 3600 },  // ₱12/km
};

// Distinct colors for up to 10 vehicles on the map
const TRUCK_COLORS = [
  '#1976D2', // blue
  '#D32F2F', // red
  '#388E3C', // green
  '#F57C00', // orange
  '#7B1FA2', // purple
  '#0097A7', // teal
  '#C2185B', // pink
  '#5D4037', // brown
  '#455A64', // slate
  '#FBC02D', // yellow
];

// ── Route ID generator ────────────────────────────────────────────────────────
async function generateRouteId() {
  const year = new Date().getFullYear();
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS cnt FROM public.route_plans WHERE route_id LIKE $1`,
    [`RT-${year}-%`]
  );
  const seq = parseInt(rows[0].cnt, 10) + 1;
  return `RT-${year}-${String(seq).padStart(3, '0')}`;
}

// ── 1. Mapbox Directions Matrix ───────────────────────────────────────────────
// Returns a full N×N matrix of travel times in seconds.
// Handles the 25-coordinate limit by stitching sub-matrices.
async function getMapboxTimeMatrix(locations) {
  const MAPBOX_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;
  if (!MAPBOX_TOKEN) throw new Error('MAPBOX_ACCESS_TOKEN not set in .env');

  const n = locations.length;

  // Fast path: fits in a single API call
  if (n <= MAX_MATRIX_COORDS) {
    return fetchMatrixChunk(locations, MAPBOX_TOKEN);
  }

  // Chunk strategy: fetch rows in blocks of MAX_MATRIX_COORDS sources
  // Each call: all n destinations, up to 25 sources
  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  const CHUNK  = MAX_MATRIX_COORDS;

  for (let srcStart = 0; srcStart < n; srcStart += CHUNK) {
    const srcEnd   = Math.min(srcStart + CHUNK, n);
    const sources  = locations.slice(srcStart, srcEnd);
    const coords   = locations.map((l) => `${l.lng},${l.lat}`).join(';');
    const srcIdx   = Array.from({ length: srcEnd - srcStart }, (_, i) => i + srcStart).join(';');
    const dstIdx   = Array.from({ length: n }, (_, i) => i).join(';');

    const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coords}` +
                `?sources=${srcIdx}&destinations=${dstIdx}` +
                `&annotations=duration&access_token=${MAPBOX_TOKEN}`;

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Mapbox Matrix error ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();

    data.durations.forEach((row, localRow) => {
      const globalRow = srcStart + localRow;
      row.forEach((val, col) => {
        matrix[globalRow][col] = Math.round(val ?? 0);
      });
    });
  }

  return matrix;
}

async function fetchMatrixChunk(locations, token) {
  const coords = locations.map((l) => `${l.lng},${l.lat}`).join(';');
  const url    = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coords}` +
                 `?annotations=duration&access_token=${token}`;
  const resp   = await fetch(url);
  if (!resp.ok) throw new Error(`Mapbox Matrix error ${resp.status}: ${await resp.text()}`);
  const data   = await resp.json();
  return data.durations.map((row) => row.map((v) => Math.round(v ?? 0)));
}

// ── 2. OR-Tools Python Bridge ─────────────────────────────────────────────────
function runPythonSolver(payload) {
  return new Promise((resolve, reject) => {
    const pythonScript = path.join(__dirname, '../python/cvrp_solver.py');
    const py = spawn('python', [pythonScript]);

    let stdout = '';
    let stderr = '';

    py.stdin.write(JSON.stringify(payload));
    py.stdin.end();

    py.stdout.on('data', (d) => { stdout += d.toString(); });
    py.stderr.on('data', (d) => { stderr += d.toString(); });

    py.on('close', (code) => {
      if (code !== 0) {
        // If OR-Tools not installed, stderr may say so — still try to parse stdout
        if (stdout.trim()) {
          try { return resolve(JSON.parse(stdout)); } catch {}
        }
        reject(new Error(`Python solver exited ${code}: ${stderr.trim()}`));
      } else {
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(new Error(`Invalid JSON from solver: ${stdout.slice(0, 200)}`));
        }
      }
    });

    py.on('error', (err) => {
      reject(new Error(`Failed to start python: ${err.message}`));
    });
  });
}

// ── 3. Persist route plan to DB ───────────────────────────────────────────────
async function persistRoutePlan(client, {
  routeId, solverResult, locations, trucks, timeMatrix, createdById,
}) {
  const startMs = Date.now();

  // Insert route plan header
  const planResult = await client.query(
    `INSERT INTO public.route_plans
       (route_id, algorithm, solver_status, solver_time_ms, total_bins, status, created_by)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6)
     RETURNING id`,
    [
      routeId,
      'CVRP-TW / PATH_CHEAPEST_ARC + GLS',
      solverResult.status ?? 'FEASIBLE',
      Date.now() - startMs,
      locations.filter((l) => !l.is_depot).length,
      createdById ?? null,
    ]
  );
  const planId = planResult.rows[0].id;

  let planTotalBins     = 0;
  let planTotalDistKm   = 0;
  let planTotalTimeSec  = 0;

  // Insert per-vehicle routes
  for (const route of solverResult.routes) {
    const truck = trucks[route.vehicle_index] ?? trucks[0];
    const color = TRUCK_COLORS[route.vehicle_index % TRUCK_COLORS.length];

    const stops    = route.stops;                         // array of location indices
    const binStops = stops.filter((i) => !locations[i].is_depot);
    let   vehicleDistKm  = 0;
    let   vehicleTimeSec = 0;

    // Calculate cumulative travel times along the stop sequence
    const legTimes = [];
    for (let s = 0; s < stops.length - 1; s++) {
      const tSec   = timeMatrix[stops[s]]?.[stops[s + 1]] ?? 0;
      legTimes.push(tSec);
      vehicleTimeSec += tSec;
      vehicleDistKm  += (tSec / 3600) * AVG_SPEED_KMH;
    }

    const vehicleResult = await client.query(
      `INSERT INTO public.route_vehicles
         (route_plan_id, truck_id, truck_name, truck_type, vehicle_index,
          max_capacity, total_load_l, total_stops, distance_km, time_min, route_color)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        planId,
        truck.id ?? null,
        truck.name,
        truck.truck_type ?? 'forward_truck',
        route.vehicle_index,
        truck.max_capacity,
        route.total_load ?? 0,
        binStops.length,
        parseFloat(vehicleDistKm.toFixed(2)),
        Math.round(vehicleTimeSec / 60),
        color,
      ]
    );
    const vehicleId = vehicleResult.rows[0].id;

    planTotalBins    += binStops.length;
    planTotalDistKm  += vehicleDistKm;
    planTotalTimeSec += vehicleTimeSec;

    // Insert per-stop details
    let cumulativeSec = 0;
    for (let s = 0; s < stops.length; s++) {
      const locIdx   = stops[s];
      const loc      = locations[locIdx];
      const legTime  = s > 0 ? (legTimes[s - 1] ?? 0) : 0;
      cumulativeSec += legTime;
      const legDistKm = (legTime / 3600) * AVG_SPEED_KMH;

      await client.query(
        `INSERT INTO public.route_stops
           (route_vehicle_id, stop_order, bin_id, bin_name, bin_barangay,
            bin_latitude, bin_longitude, bin_capacity_l, is_depot,
            travel_time_sec, distance_km,
            tw_start_sec, tw_end_sec, arrival_sec)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          vehicleId,
          s,
          loc.id ?? null,
          loc.name ?? (loc.is_depot ? 'Depot' : `Stop ${s}`),
          loc.barangay ?? null,
          loc.lat,
          loc.lng,
          loc.volume_liters ?? null,
          loc.is_depot ?? false,
          legTime,
          parseFloat(legDistKm.toFixed(3)),
          SHIFT_START_SEC,
          SHIFT_END_SEC,
          cumulativeSec,
        ]
      );
    }
  }

  // Update aggregate totals on the plan
  await client.query(
    `UPDATE public.route_plans
     SET total_bins=$1, total_distance_km=$2, total_time_min=$3
     WHERE id=$4`,
    [
      planTotalBins,
      parseFloat(planTotalDistKm.toFixed(2)),
      Math.round(planTotalTimeSec / 60),
      planId,
    ]
  );

  return planId;
}

// ── 4. Main handler ───────────────────────────────────────────────────────────
async function handleRouteGeneration(createdById = null) {
  const solveStart = Date.now();

  // ── Fetch bins ──────────────────────────────────────────────────────────────
  const binsResult = await pool.query(`
    SELECT
      b.id, b.name, b.barangay,
      b.latitude  AS lat,
      b.longitude AS lng,
      COALESCE(t.capacity_liters, 660)    AS volume_liters,
      b.is_depot,
      b.road_type,
      b.allowed_truck_types
    FROM public.bins b
    LEFT JOIN public.tiers t ON t.id = b.tier_id
    WHERE b.is_depot = true OR b.status = 'FULL'
    ORDER BY b.is_depot DESC
  `);

  const locations = binsResult.rows;

  if (locations.length <= 1) {
    console.log('[Route] No FULL bins — skipping optimization.');
    return null;
  }

  const depot = locations[0];
  if (!depot.is_depot) throw new Error('Depot must be the first location.');

  // ── Fetch active trucks (apply capacity margin) ─────────────────────────────
  const trucksResult = await pool.query(`
    SELECT id, name, truck_type, max_capacity
    FROM public.trucks
    WHERE status NOT IN ('maintenance', 'inactive')
    ORDER BY max_capacity DESC, name ASC
  `);

  const trucks = trucksResult.rows.length > 0
    ? trucksResult.rows.map((t) => ({
        ...t,
        effective_capacity: Math.floor(t.max_capacity * (1 - CAPACITY_MARGIN)),
      }))
    : [{ id: null, name: 'Truck 01', truck_type: 'forward_truck', max_capacity: 7000, effective_capacity: 6650 }];

  // ── Build time matrix via Mapbox ────────────────────────────────────────────
  console.log(`[Route] Fetching Mapbox time matrix for ${locations.length} locations…`);
  const timeMatrix = await getMapboxTimeMatrix(locations);

  // ── Build solver payload ────────────────────────────────────────────────────
  const demands    = locations.map((l) => l.is_depot ? 0 : (l.volume_liters ?? 0));
  const capacities = trucks.map((t) => t.effective_capacity);

  // Per-vehicle cost arrays (Heterogeneous Fleet)
  const fixedCosts   = trucks.map((t) => (TRUCK_COST_PROFILE[t.truck_type] ?? TRUCK_COST_PROFILE['forward_truck']).fixed);
  const fuelPerSec   = trucks.map((t) => (TRUCK_COST_PROFILE[t.truck_type] ?? TRUCK_COST_PROFILE['forward_truck']).fuel_per_sec);

  // Per-stop vehicle allowlist — map truck types to vehicle indices
  // allowed_truck_types from DB e.g. ["forward_truck","mini_dump_truck"]
  // → translate to vehicle indices [1, 3, 4, 5, 6] (indices of matching trucks)
  const allowedVehicleIds = locations.map((loc) => {
    if (loc.is_depot || !loc.allowed_truck_types) return null; // no restriction
    const allowedTypes = Array.isArray(loc.allowed_truck_types)
      ? loc.allowed_truck_types
      : JSON.parse(loc.allowed_truck_types);
    return trucks
      .map((t, idx) => allowedTypes.includes(t.truck_type) ? idx : -1)
      .filter((idx) => idx >= 0);
  });

  // Per-bin time windows: depot [0, shift_end], bins [0, shift_end]
  const timeWindows = locations.map(() => [SHIFT_START_SEC, SHIFT_END_SEC]);

  const payload = {
    time_matrix:         timeMatrix,
    demands,
    vehicle_capacities:  capacities,
    vehicle_fixed_costs: fixedCosts,
    vehicle_fuel_costs:  fuelPerSec,
    allowed_vehicle_ids: allowedVehicleIds,
    num_vehicles:        trucks.length,
    starts:              trucks.map(() => 0),
    ends:                trucks.map(() => 0),
    time_windows:        timeWindows,
    max_shift_sec:       SHIFT_END_SEC,
    solver_time_limit:   15,
  };

  // ── Run OR-Tools solver ─────────────────────────────────────────────────────
  console.log(`[Route] Running OR-Tools CVRP-TW solver (${trucks.length} trucks, ${locations.length - 1} bins)…`);
  const solverResult = await runPythonSolver(payload);
  const solveMs      = Date.now() - solveStart;

  console.log(`[Route] Solver status: ${solverResult.status} in ${solveMs}ms`);

  if (!solverResult.routes || solverResult.routes.length === 0) {
    console.warn('[Route] Solver returned no routes.');
    return { routes: [], status: solverResult.status, planId: null };
  }

  // ── Persist to DB ────────────────────────────────────────────────────────────
  const routeId = await generateRouteId();
  const client  = await pool.connect();

  try {
    await client.query('BEGIN');
    const planId = await persistRoutePlan(client, {
      routeId,
      solverResult: { ...solverResult, solver_time_ms: solveMs },
      locations,
      trucks,
      timeMatrix,
      createdById,
    });
    await client.query('COMMIT');
    console.log(`[Route] Route ${routeId} persisted (plan ${planId}).`);

    return {
      planId,
      routeId,
      status:  solverResult.status,
      routes:  solverResult.routes,
      trucks,
      locations,
      timeMatrix,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Route] Persist failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { handleRouteGeneration, TRUCK_COLORS };
