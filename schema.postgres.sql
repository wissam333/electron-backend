-- sync-backend/schema.postgres.sql
-- Run this once on your PostgreSQL database to create all tables.
-- Mirrors the SQLite schema with INTEGER ids and PostgreSQL types.

-- ─────────────────────────────────────────────────────────────────────────────
--  PATIENTS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patients (
  id            BIGINT       PRIMARY KEY,
  full_name     TEXT         NOT NULL,
  gender        TEXT         CHECK (gender IN ('male','female','other')),
  dob           TEXT,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  blood_type    TEXT,
  allergies     TEXT,
  notes         TEXT,
  visit_count   INTEGER      DEFAULT 0,
  last_visit    TEXT,
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  DEFAULT NOW(),
  _deleted      BOOLEAN      DEFAULT FALSE,
  synced_at     TIMESTAMPTZ
);

-- ─────────────────────────────────────────────────────────────────────────────
--  STAFF
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff (
  id          BIGINT       PRIMARY KEY,
  full_name   TEXT         NOT NULL,
  username    TEXT         UNIQUE,
  password    TEXT,
  role        TEXT         CHECK (role IN ('admin','doctor','nurse','receptionist')),
  specialty   TEXT,
  phone       TEXT,
  email       TEXT,
  is_active   BOOLEAN      DEFAULT TRUE,
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  DEFAULT NOW(),
  _deleted    BOOLEAN      DEFAULT FALSE,
  synced_at   TIMESTAMPTZ
);

-- ─────────────────────────────────────────────────────────────────────────────
--  VISITS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visits (
  id               BIGINT       PRIMARY KEY,
  patient_id       BIGINT       REFERENCES patients(id) ON DELETE SET NULL,
  doctor_id        BIGINT       REFERENCES staff(id)    ON DELETE SET NULL,
  visit_date       TIMESTAMPTZ  DEFAULT NOW(),
  chief_complaint  TEXT,
  diagnosis        TEXT,
  treatment        TEXT,
  notes            TEXT,
  status           TEXT         DEFAULT 'open' CHECK (status IN ('open','closed','followup')),
  fee              NUMERIC(10,2) DEFAULT 0,
  paid             BOOLEAN      DEFAULT FALSE,
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  DEFAULT NOW(),
  _deleted         BOOLEAN      DEFAULT FALSE,
  synced_at        TIMESTAMPTZ
);

-- ─────────────────────────────────────────────────────────────────────────────
--  PRESCRIPTIONS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prescriptions (
  id           BIGINT       PRIMARY KEY,
  visit_id     BIGINT       REFERENCES visits(id)   ON DELETE SET NULL,
  patient_id   BIGINT       REFERENCES patients(id) ON DELETE SET NULL,
  drug_name    TEXT         NOT NULL,
  dose         TEXT,
  route        TEXT,
  frequency    TEXT,
  duration     TEXT,
  instructions TEXT,
  created_at   TIMESTAMPTZ  DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  DEFAULT NOW(),
  _deleted     BOOLEAN      DEFAULT FALSE,
  synced_at    TIMESTAMPTZ
);

-- ─────────────────────────────────────────────────────────────────────────────
--  INVESTIGATIONS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS investigations (
  id          BIGINT       PRIMARY KEY,
  visit_id    BIGINT       REFERENCES visits(id)   ON DELETE SET NULL,
  patient_id  BIGINT       REFERENCES patients(id) ON DELETE SET NULL,
  test_name   TEXT         NOT NULL,
  test_type   TEXT,
  ordered_at  TIMESTAMPTZ  DEFAULT NOW(),
  result      TEXT,
  result_at   TIMESTAMPTZ,
  status      TEXT         DEFAULT 'pending' CHECK (status IN ('pending','resulted','reviewed')),
  notes       TEXT,
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  DEFAULT NOW(),
  _deleted    BOOLEAN      DEFAULT FALSE,
  synced_at   TIMESTAMPTZ
);

-- ─────────────────────────────────────────────────────────────────────────────
--  APPOINTMENTS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id           BIGINT       PRIMARY KEY,
  patient_id   BIGINT       REFERENCES patients(id) ON DELETE SET NULL,
  doctor_id    BIGINT       REFERENCES staff(id)    ON DELETE SET NULL,
  appt_date    TIMESTAMPTZ  NOT NULL,
  duration_min INTEGER      DEFAULT 30,
  reason       TEXT,
  status       TEXT         DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled','no_show')),
  notes        TEXT,
  created_at   TIMESTAMPTZ  DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  DEFAULT NOW(),
  _deleted     BOOLEAN      DEFAULT FALSE,
  synced_at    TIMESTAMPTZ
);

-- ─────────────────────────────────────────────────────────────────────────────
--  Indexes for pull queries (filtering by updated_at is the hot path)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_patients_updated_at       ON patients(updated_at);
CREATE INDEX IF NOT EXISTS idx_staff_updated_at          ON staff(updated_at);
CREATE INDEX IF NOT EXISTS idx_visits_updated_at         ON visits(updated_at);
CREATE INDEX IF NOT EXISTS idx_prescriptions_updated_at  ON prescriptions(updated_at);
CREATE INDEX IF NOT EXISTS idx_investigations_updated_at ON investigations(updated_at);
CREATE INDEX IF NOT EXISTS idx_appointments_updated_at   ON appointments(updated_at);