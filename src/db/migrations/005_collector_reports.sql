-- ─── Migration 005 — Collector Incident Reports ──────────────────────────────
-- Creates the collector_reports table for storing route interruption reports
-- submitted by collectors via the mobile app.
-- Run after 004_bin_scan_rewards.sql

CREATE TABLE IF NOT EXISTS public.collector_reports (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  collector_id      UUID          NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  issue_type        TEXT          NOT NULL
    CHECK (issue_type IN ('Vehicle Problem', 'Traffic Jam', 'Road Closure', 'Weather Condition', 'Other')),
  notes             TEXT,
  stops_completed   INTEGER       NOT NULL DEFAULT 0,
  stops_total       INTEGER       NOT NULL DEFAULT 0,
  status            TEXT          NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'resolved')),
  reported_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ,
  resolved_by       UUID          REFERENCES public.users(id) ON DELETE SET NULL
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_collector_reports_collector_id
  ON public.collector_reports (collector_id);

CREATE INDEX IF NOT EXISTS idx_collector_reports_status
  ON public.collector_reports (status);

CREATE INDEX IF NOT EXISTS idx_collector_reports_reported_at
  ON public.collector_reports (reported_at DESC);
