-- =============================================================================
-- Migration 013: Add mrf_qr_codes table
--
-- MRF QR codes are managed by the Punong Barangay.
-- Each record represents one MRF location, identified by a server-signed
-- HMAC-SHA256 QR payload (same pattern as bins).
-- Records are immutable after creation — delete and re-create to update.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.mrf_qr_codes (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(150) NOT NULL,
  barangay    VARCHAR(150) NOT NULL,
  address     TEXT,
  latitude    NUMERIC(10, 7),
  longitude   NUMERIC(10, 7),
  qr_payload  TEXT,
  created_by  UUID         REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mrf_qr_codes_barangay ON public.mrf_qr_codes(barangay);
