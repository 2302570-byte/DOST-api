-- ============================================================
-- Migration 002: Route history table
-- Stores persisted CVRP-TW results from OR-Tools optimizer.
-- Each optimization run creates one row in route_plans,
-- with per-vehicle routes stored in route_vehicles and
-- per-stop details in route_stops.
-- ============================================================

-- ── route_plans ───────────────────────────────────────────────────────────────
-- One row per optimization run (triggered by super_admin).

CREATE TABLE IF NOT EXISTS public.route_plans (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  route_id         VARCHAR(30) NOT NULL UNIQUE,   -- e.g. RT-2026-001

  -- Solver metadata
  algorithm        VARCHAR(50) NOT NULL DEFAULT 'CVRP-TW / PATH_CHEAPEST_ARC + GLS',
  solver_status    VARCHAR(20) NOT NULL DEFAULT 'FEASIBLE'
                     CHECK (solver_status IN ('OPTIMAL', 'FEASIBLE', 'NO_SOLUTION', 'ERROR')),
  solver_time_ms   INTEGER,                        -- wall-clock solver duration

  -- Aggregate stats (sum across all vehicles)
  total_bins       INTEGER     NOT NULL DEFAULT 0,
  total_distance_km NUMERIC(8,2),
  total_time_min   INTEGER,

  -- Lifecycle
  status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'sent', 'in_progress', 'completed', 'cancelled')),

  -- Who triggered and who received
  created_by       UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  sent_to          UUID        REFERENCES public.users(id) ON DELETE SET NULL,  -- collector admin
  sent_at          TIMESTAMPTZ,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_route_plans_status     ON public.route_plans(status);
CREATE INDEX IF NOT EXISTS idx_route_plans_created_at ON public.route_plans(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_route_plans_route_id   ON public.route_plans(route_id);

DROP TRIGGER IF EXISTS trg_route_plans_updated_at ON public.route_plans;
CREATE TRIGGER trg_route_plans_updated_at
  BEFORE UPDATE ON public.route_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ── route_vehicles ────────────────────────────────────────────────────────────
-- One row per truck assigned in a route plan.

CREATE TABLE IF NOT EXISTS public.route_vehicles (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  route_plan_id  UUID    NOT NULL REFERENCES public.route_plans(id) ON DELETE CASCADE,
  truck_id       UUID    REFERENCES public.trucks(id) ON DELETE SET NULL,
  truck_name     VARCHAR(100),    -- snapshot in case truck is deleted
  truck_type     VARCHAR(50),
  vehicle_index  INTEGER NOT NULL, -- OR-Tools vehicle index (0-based)
  max_capacity   INTEGER,

  -- Route totals for this vehicle
  total_load_l   INTEGER,         -- liters collected
  total_stops    INTEGER,
  distance_km    NUMERIC(8,2),
  time_min       INTEGER,

  -- Color for map rendering (each vehicle gets a distinct color)
  route_color    VARCHAR(7)  NOT NULL DEFAULT '#1976D2',  -- hex

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_route_vehicles_plan ON public.route_vehicles(route_plan_id);


-- ── route_stops ───────────────────────────────────────────────────────────────
-- One row per bin stop in a vehicle's route (ordered by stop_order).

CREATE TABLE IF NOT EXISTS public.route_stops (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  route_vehicle_id UUID    NOT NULL REFERENCES public.route_vehicles(id) ON DELETE CASCADE,
  stop_order       INTEGER NOT NULL,   -- 0 = depot (start), N+1 = depot (end)

  -- Bin reference
  bin_id           UUID    REFERENCES public.bins(id) ON DELETE SET NULL,
  bin_name         VARCHAR(150),       -- snapshot
  bin_barangay     VARCHAR(150),
  bin_latitude     NUMERIC(10,7),
  bin_longitude    NUMERIC(10,7),
  bin_capacity_l   INTEGER,            -- snapshot of tier capacity
  is_depot         BOOLEAN NOT NULL DEFAULT false,

  -- Travel leg FROM previous stop TO this stop
  travel_time_sec  INTEGER,            -- Mapbox matrix value (seconds)
  distance_km      NUMERIC(8,2),       -- estimated from travel time

  -- Time window (seconds from shift start 07:00)
  tw_start_sec     INTEGER,
  tw_end_sec       INTEGER,

  -- Earliest arrival (cumulative from solver)
  arrival_sec      INTEGER,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_route_stops_vehicle  ON public.route_stops(route_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_route_stops_order    ON public.route_stops(route_vehicle_id, stop_order);
CREATE INDEX IF NOT EXISTS idx_route_stops_bin_id   ON public.route_stops(bin_id);
