-- ─── BE-SMART Core Schema ─────────────────────────────────────────────────────
-- Run this ONCE on a fresh database before running eco-schema.sql.
-- The eco-schema.sql migration (npm run db:migrate) runs eco tables on top of this.

-- ─── user_role enum ───────────────────────────────────────────────────────────
CREATE TYPE public.user_role AS ENUM (
  'resident',
  'collector',
  'mrf_worker',
  'mrf_buyer',
  'punong_barangay',
  'collector_admin',
  'cluster_admin',
  'super_admin'
);

-- ─── Trigger function for updated_at ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ─── users table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  name          character varying(100)   NOT NULL,
  email         character varying(150)   NOT NULL,
  phone         character varying(20),
  password_hash text                     NOT NULL,
  role          user_role                NOT NULL,
  barangay      character varying(100),
  address       text,
  is_active     boolean                  NOT NULL DEFAULT true,
  created_at    timestamp with time zone NOT NULL DEFAULT now(),
  updated_at    timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT users_pkey      PRIMARY KEY (id),
  CONSTRAINT users_email_key UNIQUE (email)
) TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.users OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_users_email
  ON public.users USING btree (email ASC NULLS LAST)
  TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_users_role
  ON public.users USING btree (role ASC NULLS LAST)
  TABLESPACE pg_default;

CREATE OR REPLACE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ─── Seed users ───────────────────────────────────────────────────────────────
-- Passwords: all use the well-known test hash (decodes to "password").
-- Replace with real bcrypt hashes before any non-development use.
INSERT INTO users (name, email, phone, password_hash, role, barangay, address)
VALUES
  ('Juan Dela Cruz',      'resident@besmart.ph',          '+63 917 123 4567', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'resident',        'Brgy. Kumintang Ibaba', '123 Rizal Ave, Batangas City'),
  ('Carlos Reyes',        'mrf@besmart.ph',                '+63 918 456 7890', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'mrf_worker',      'Brgy. Alangilan',       'MRF Compound, Brgy. Alangilan, Batangas City'),
  ('Ramon Villanueva',    'buyer@besmart.ph',              '+63 919 876 5432', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'mrf_buyer',       'Brgy. Cuta',            '45 Burgos St, Batangas City'),
  ('Pedro Santos',        'collector@besmart.ph',          '+63 919 876 5432', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'collector',       'Brgy. Kumintang Ibaba', 'Zone 3, Batangas City'),
  ('Hon. Juan dela Cruz', 'punongbarangay@besmart.gov.ph', '+63 917 000 0001', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'punong_barangay', 'Brgy. Alangilan',       'Brgy. Alangilan Hall, Batangas City'),
  ('Juan dela Cruz',      'collectoradmin@besmart.gov.ph', '+63 917 000 0002', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'collector_admin', NULL,                    'Batangas City Hall, Batangas City'),
  ('Maria Santos',        'clusteradmin@besmart.gov.ph',   '+63 917 000 0003', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'cluster_admin',   NULL,                    'Batangas City Hall, Batangas City'),
  ('Super Admin',         'superadmin@besmart.gov.ph',     '+63 917 000 0000', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'super_admin',     NULL,                    'Batangas City Hall, Batangas City')
ON CONFLICT (email) DO NOTHING;
