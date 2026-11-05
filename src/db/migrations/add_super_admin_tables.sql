-- =============================================================================
-- Migration: Super Admin Tables
-- Adds: barangays, collection_routes, notifications
-- Run: psql "<DATABASE_URL>" -f src/db/migrations/add_super_admin_tables.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- barangays
-- Canonical list of barangays in Batangas City.
-- The punong_barangay user links to this via users.barangay = barangays.name.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.barangays (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(150)  NOT NULL UNIQUE,
  captain         VARCHAR(150),
  contact_email   VARCHAR(150),
  status          VARCHAR(20)   NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_barangays_updated_at ON public.barangays;
CREATE TRIGGER trg_barangays_updated_at
  BEFORE UPDATE ON public.barangays
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- No seed data — Super Admin will create barangays dynamically via the UI

-- ---------------------------------------------------------------------------
-- collection_routes
-- History of all optimized routes dispatched by Super Admin.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.collection_routes (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id          VARCHAR(30)  NOT NULL UNIQUE,  -- e.g. "RT-2025-006"
  date              DATE         NOT NULL,
  bin_ids           UUID[]       NOT NULL DEFAULT '{}',
  distance_km       NUMERIC(6,1),
  estimated_minutes INTEGER,
  algorithm         VARCHAR(50)  DEFAULT 'Nearest Neighbor',
  truck_no          VARCHAR(50),
  sent_to           VARCHAR(100) DEFAULT 'Collector Admin',
  status            VARCHAR(20)  NOT NULL DEFAULT 'delivered'
    CHECK (status IN ('completed', 'in_progress', 'delivered', 'cancelled')),
  optimized_at      TIMESTAMPTZ,
  sent_at           TIMESTAMPTZ,
  created_by        UUID         REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collection_routes_date   ON public.collection_routes(date DESC);
CREATE INDEX IF NOT EXISTS idx_collection_routes_status ON public.collection_routes(status);

-- ---------------------------------------------------------------------------
-- notifications
-- Announcements broadcast by Super Admin to all portal users.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  type      VARCHAR(30)  NOT NULL DEFAULT 'announcement'
    CHECK (type IN ('announcement', 'schedule', 'complete', 'report', 'task')),
  title     VARCHAR(200) NOT NULL,
  body      TEXT         NOT NULL,
  target    VARCHAR(50)  NOT NULL DEFAULT 'all',
  priority  VARCHAR(20)  NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('normal', 'urgent')),
  sent_by   UUID         REFERENCES public.users(id) ON DELETE SET NULL,
  sent_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  read      BOOLEAN      NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_notifications_sent_at  ON public.notifications(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_priority ON public.notifications(priority);

SELECT 'Migration complete: barangays, collection_routes, notifications tables created.' AS result;
