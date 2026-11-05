-- =============================================================================
-- Migration: Clusters & Cluster-Barangay Assignment (Batangas City — Official)
-- Run: psql "<DATABASE_URL>" -f src/db/migrations/add_clusters.sql
-- Safe to re-run: uses ON CONFLICT DO NOTHING everywhere.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- clusters table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clusters (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(100) NOT NULL UNIQUE,
  label      VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_clusters_updated_at ON public.clusters;
CREATE TRIGGER trg_clusters_updated_at
  BEFORE UPDATE ON public.clusters
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- cluster_barangays junction table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cluster_barangays (
  cluster_id   UUID NOT NULL REFERENCES public.clusters(id)  ON DELETE CASCADE,
  barangay_id  UUID NOT NULL REFERENCES public.barangays(id) ON DELETE CASCADE,
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cluster_id, barangay_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cb_one_cluster_per_barangay
  ON public.cluster_barangays(barangay_id);

CREATE INDEX IF NOT EXISTS idx_cb_cluster_id ON public.cluster_barangays(cluster_id);

-- No seed data — Super Admin will create clusters and barangays dynamically via the UI

SELECT 'Migration complete: cluster and cluster_barangays tables created. Zero records seeded — ready for dynamic management.' AS result;

