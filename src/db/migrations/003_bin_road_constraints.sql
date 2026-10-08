-- ============================================================
-- Migration 003: Heterogeneous Fleet VRP constraints on bins
--
-- road_type:          'highway' | 'main_road' | 'narrow_street'
-- allowed_truck_types: JSON array of allowed truck types
--                      e.g. ["10_wheeler","forward_truck","mini_dump_truck"]
--                      null = all truck types allowed
--
-- These fields are used by the CVRP-TW solver to enforce
-- road dimension constraints (narrow streets block large trucks).
-- ============================================================

ALTER TABLE public.bins
  ADD COLUMN IF NOT EXISTS road_type           VARCHAR(20) DEFAULT 'main_road'
    CHECK (road_type IN ('highway', 'main_road', 'narrow_street')),
  ADD COLUMN IF NOT EXISTS allowed_truck_types JSONB       DEFAULT NULL;

-- Create index for fast road-type queries
CREATE INDEX IF NOT EXISTS idx_bins_road_type ON public.bins(road_type);

-- ── Assign road types based on known Batangas City geography ─────────────────
-- Highways (Diversion Road, national highway corridors):
UPDATE public.bins SET road_type = 'highway'
WHERE barangay IN ('Alangilan', 'Kumintang', 'Bolbok')
  AND is_depot = false;

-- Narrow streets (dense barangays with tight alleys):
UPDATE public.bins SET road_type = 'narrow_street'
WHERE barangay IN ('Cuta', 'Libjo', 'Gulod', 'Sta. Rita', 'Balagtas', 'Pallocan')
  AND is_depot = false;

-- Main roads (everything else stays default):
-- Poblacion, Sampaga, Dumantay, San Jose, Pallocan East, Kumintang East

-- ── Set allowed truck types based on road type ────────────────────────────────
-- Narrow streets: only mini-dump and forward trucks can enter
UPDATE public.bins
SET allowed_truck_types = '["forward_truck","mini_dump_truck"]'::jsonb
WHERE road_type = 'narrow_street' AND is_depot = false;

-- Highways: all trucks allowed (NULL = no restriction)
UPDATE public.bins
SET allowed_truck_types = NULL
WHERE road_type = 'highway' AND is_depot = false;

-- Main roads: forward truck and 10-wheeler allowed (no mini-dump on main arterials)
UPDATE public.bins
SET allowed_truck_types = '["10_wheeler","forward_truck"]'::jsonb
WHERE road_type = 'main_road' AND is_depot = false;
