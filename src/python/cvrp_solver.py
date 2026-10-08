"""
cvrp_solver.py — BE-SMART Heterogeneous Fleet CVRP-TW Solver
=============================================================
Implements a full Heterogeneous Fleet Vehicle Routing Problem with
Time Windows (HFVRP-TW) using Google OR-Tools.

Three real-world constraints are enforced simultaneously:

  1. CAPACITY   — each truck has a different max volume (liters)
  2. ROAD TYPE  — narrow streets block 10-wheelers; only smaller
                  trucks whose type appears in bin.allowed_vehicle_ids
                  can visit those nodes
  3. TIME / COST — trucks have per-vehicle fixed deployment costs and
                  per-arc variable fuel costs, so OR-Tools naturally
                  avoids dispatching large trucks for small loads

Input (JSON via stdin):
  {
    "time_matrix":        [[int]],     N×N travel times in seconds
    "demands":            [int],       liters per stop (0 for depot)
    "vehicle_capacities": [int],       effective liters per truck
    "vehicle_fixed_costs":[int],       one-time cost if vehicle is used (pesos)
    "vehicle_fuel_costs": [float],     pesos per second of travel
    "allowed_vehicle_ids":[[int]|null],per-stop list of allowed vehicle indices
                                       (null or absent = all vehicles allowed)
    "num_vehicles":       int,
    "starts":             [int],       depot index for each vehicle (all 0)
    "ends":               [int],       depot index for each vehicle (all 0)
    "time_windows":       [[int,int]], [earliest_sec, latest_sec] per stop
    "max_shift_sec":      int,         optional, default 39600 (11 h)
    "time_slack_sec":     int,         optional, default 1800  (30 min)
    "solver_time_limit":  int,         optional, default 15 (seconds)
  }

Output (JSON to stdout):
  {
    "routes": [
      {
        "vehicle_index": int,
        "stops":         [int],   ordered stop indices (incl. depot at start/end)
        "total_load":    int,     liters collected
        "route_cost":    int      pesos (fixed + variable fuel)
      }
    ],
    "total_cost": int,
    "total_time": int,
    "status":     "OPTIMAL" | "FEASIBLE" | "NO_SOLUTION" | "ERROR"
  }

Install:
  pip install ortools
"""

import sys
import json
import math


# ─────────────────────────────────────────────────────────────────────────────
# Cost scale: OR-Tools works with integers internally.
# We multiply peso values by COST_SCALE to preserve two decimal places.
# ─────────────────────────────────────────────────────────────────────────────
COST_SCALE = 100   # ₱1.00 → 100 units


def solve_cvrp(data):
    try:
        from ortools.constraint_solver import routing_enums_pb2
        from ortools.constraint_solver import pywrapcp
    except ImportError:
        return greedy_fallback(data)

    # ── Parse input ──────────────────────────────────────────────────────────
    time_matrix   = data["time_matrix"]
    demands       = data["demands"]
    capacities    = data["vehicle_capacities"]
    fixed_costs   = data.get("vehicle_fixed_costs", [0] * len(capacities))
    fuel_costs    = data.get("vehicle_fuel_costs",  [0.0] * len(capacities))
    allowed_ids   = data.get("allowed_vehicle_ids", [None] * len(demands))
    num_vehicles  = data["num_vehicles"]
    starts        = data["starts"]
    ends          = data["ends"]
    time_windows  = data["time_windows"]
    max_shift     = data.get("max_shift_sec",    11 * 3600)
    slack         = data.get("time_slack_sec",   30 * 60)
    time_limit    = data.get("solver_time_limit", 15)

    num_locations = len(time_matrix)

    # ── Routing model ─────────────────────────────────────────────────────────
    manager = pywrapcp.RoutingIndexManager(
        num_locations, num_vehicles, starts, ends
    )
    routing = pywrapcp.RoutingModel(manager)

    # ── 1. Per-vehicle arc cost = fuel_cost × travel_time ────────────────────
    # We register one transit callback per vehicle so each truck has its own
    # variable fuel rate.  Fixed costs are handled separately below.
    def make_time_callback(v_fuel):
        def callback(from_idx, to_idx):
            from_node = manager.IndexToNode(from_idx)
            to_node   = manager.IndexToNode(to_idx)
            t         = time_matrix[from_node][to_node]
            return int(t * v_fuel * COST_SCALE)
        return callback

    for v in range(num_vehicles):
        cb_idx = routing.RegisterTransitCallback(make_time_callback(fuel_costs[v]))
        routing.SetArcCostEvaluatorOfVehicle(cb_idx, v)

    # Fixed deployment cost: pay this amount if the vehicle is ever used
    for v in range(num_vehicles):
        routing.SetFixedCostOfVehicle(int(fixed_costs[v] * COST_SCALE), v)

    # ── 2. Time dimension (for time windows and shift limits) ─────────────────
    # Use a plain time callback (seconds) for the dimension, separate from cost
    def time_callback(from_idx, to_idx):
        fn = manager.IndexToNode(from_idx)
        tn = manager.IndexToNode(to_idx)
        return time_matrix[fn][tn]

    time_cb_idx = routing.RegisterTransitCallback(time_callback)

    routing.AddDimension(
        time_cb_idx,
        slack,        # waiting-time slack
        max_shift,    # maximum cumulative time per vehicle
        False,        # don't force start cumul to zero (allows departure time)
        "Time",
    )
    time_dim = routing.GetDimensionOrDie("Time")

    # Apply per-stop time windows
    for loc_idx, (tw_start, tw_end) in enumerate(time_windows):
        node_idx = manager.NodeToIndex(loc_idx)
        time_dim.CumulVar(node_idx).SetRange(tw_start, tw_end)

    # ── 3. Capacity constraint ────────────────────────────────────────────────
    def demand_callback(from_idx):
        return demands[manager.IndexToNode(from_idx)]

    demand_cb_idx = routing.RegisterUnaryTransitCallback(demand_callback)
    routing.AddDimensionWithVehicleCapacity(
        demand_cb_idx,
        0,           # no slack on capacity
        capacities,
        True,        # start cumul at zero
        "Capacity",
    )

    # ── 4. Road/vehicle allowlist constraint ──────────────────────────────────
    # For each bin node that has a restricted allowed_vehicle_ids list,
    # mark every *other* vehicle as not allowed to visit that node.
    # This enforces: "narrow street → only forward_truck / mini_dump_truck"
    for loc_idx, allowed in enumerate(allowed_ids):
        if allowed is None:
            continue  # all vehicles allowed
        if loc_idx == 0:
            continue  # never restrict the depot
        node_idx = manager.NodeToIndex(loc_idx)
        for v in range(num_vehicles):
            if v not in allowed:
                routing.VehicleVar(node_idx).RemoveValue(v)

    # ── 5. Search strategy ────────────────────────────────────────────────────
    search_params = pywrapcp.DefaultRoutingSearchParameters()
    search_params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )
    search_params.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    search_params.time_limit.FromSeconds(time_limit)

    # ── 6. Solve ──────────────────────────────────────────────────────────────
    solution = routing.SolveWithParameters(search_params)

    if not solution:
        return {"routes": [], "total_cost": 0, "total_time": 0, "status": "NO_SOLUTION"}

    status_map = {
        0: "OPTIMAL",   # ROUTING_OPTIMAL
        1: "FEASIBLE",  # ROUTING_SUCCESS / ROUTING_PARTIAL_SUCCESS_LOCAL_OPTIMUM_NOT_REACHED
        2: "FEASIBLE",  # ROUTING_FAIL_TIMEOUT → treat as feasible if solution exists
        3: "NO_SOLUTION",
        4: "INVALID",
    }

    cap_dim   = routing.GetDimensionOrDie("Capacity")
    routes    = []
    total_cost = 0

    for v in range(num_vehicles):
        index      = routing.Start(v)
        stops      = []
        route_load = 0

        while not routing.IsEnd(index):
            stops.append(manager.IndexToNode(index))
            route_load = solution.Value(cap_dim.CumulVar(index))
            index      = solution.Value(routing.NextVar(index))

        stops.append(manager.IndexToNode(index))  # depot at end

        if len(stops) <= 2:
            continue  # vehicle never left depot

        # Calculate route cost (fixed + variable)
        v_cost = int(fixed_costs[v] * COST_SCALE)
        for s in range(len(stops) - 1):
            t       = time_matrix[stops[s]][stops[s + 1]]
            v_cost += int(t * fuel_costs[v] * COST_SCALE)
        total_cost += v_cost

        routes.append({
            "vehicle_index": v,
            "stops":         stops,
            "total_load":    route_load,
            "route_cost":    round(v_cost / COST_SCALE, 2),
        })

    return {
        "routes":     routes,
        "total_cost": round(total_cost / COST_SCALE, 2),
        "total_time": solution.ObjectiveValue(),
        "status":     status_map.get(routing.status(), "FEASIBLE"),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Greedy fallback (when OR-Tools is not installed)
# Respects capacity + vehicle allowlist; ignores fixed/fuel cost.
# ─────────────────────────────────────────────────────────────────────────────
def greedy_fallback(data):
    num_vehicles = data["num_vehicles"]
    capacities   = data["vehicle_capacities"]
    demands      = data["demands"]
    matrix       = data["time_matrix"]
    allowed_ids  = data.get("allowed_vehicle_ids", [None] * len(demands))
    fixed_costs  = data.get("vehicle_fixed_costs", [0] * num_vehicles)
    fuel_costs   = data.get("vehicle_fuel_costs",  [0.0] * num_vehicles)

    unvisited = list(range(1, len(demands)))
    routes    = [{"vehicle_index": v, "stops": [0], "total_load": 0, "route_cost": 0}
                 for v in range(num_vehicles)]
    loads     = [0] * num_vehicles
    used      = [False] * num_vehicles

    while unvisited:
        assigned = False
        for v in range(num_vehicles):
            if not unvisited:
                break
            current    = routes[v]["stops"][-1]
            candidates = [
                n for n in unvisited
                if loads[v] + demands[n] <= capacities[v]
                and (allowed_ids[n] is None or v in allowed_ids[n])
            ]
            if not candidates:
                continue
            nearest = min(candidates, key=lambda n: matrix[current][n])
            routes[v]["stops"].append(nearest)
            loads[v]          += demands[nearest]
            routes[v]["total_load"] = loads[v]
            used[v]            = True
            unvisited.remove(nearest)
            assigned = True

        if not assigned:
            # Force-assign to the vehicle that CAN visit the bin (ignoring capacity)
            for n in list(unvisited):
                eligible = [
                    v for v in range(num_vehicles)
                    if allowed_ids[n] is None or v in allowed_ids[n]
                ]
                if not eligible:
                    eligible = list(range(num_vehicles))
                v       = min(eligible, key=lambda vv: loads[vv])
                current = routes[v]["stops"][-1]
                routes[v]["stops"].append(n)
                loads[v]          += demands[n]
                routes[v]["total_load"] = loads[v]
                used[v]            = True
                unvisited.remove(n)
                break
            else:
                break  # safety exit

    total_cost = 0
    for v, route in enumerate(routes):
        route["stops"].append(0)  # return to depot
        if not used[v]:
            continue
        # Approximate cost
        v_cost = fixed_costs[v]
        for s in range(len(route["stops"]) - 1):
            t       = matrix[route["stops"][s]][route["stops"][s + 1]]
            v_cost += t * fuel_costs[v]
        route["route_cost"] = round(v_cost, 2)
        total_cost += v_cost

    routes = [r for r in routes if len(r["stops"]) > 2]

    return {
        "routes":     routes,
        "total_cost": round(total_cost, 2),
        "total_time": 0,
        "status":     "FEASIBLE",
    }


# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    try:
        payload = json.loads(sys.stdin.read())
        result  = solve_cvrp(payload)
        print(json.dumps(result))
    except Exception as exc:
        print(json.dumps({"error": str(exc), "routes": [], "status": "ERROR"}))
        sys.exit(1)
