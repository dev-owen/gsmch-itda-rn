-- Apply after db/schema.sql. Auth identity/session tables remain owned by Better Auth.
-- One database owns the bulletin's canonical EVENT and all registration decisions.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Deferral lets a bulletin reorder its existing advertisements without replacing their IDs.
ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_bulletin_id_position_key;
ALTER TABLE promotions ADD CONSTRAINT promotions_bulletin_id_position_key
  UNIQUE (bulletin_id,position) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS app_users (
  user_id text PRIMARY KEY,
  name text NOT NULL DEFAULT '' CHECK (char_length(name) <= 50),
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  is_member_verified boolean NOT NULL DEFAULT false,
  member_verification_revoked_at timestamptz,
  verification_requested_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','merged','deleting')),
  merged_into_user_id text REFERENCES app_users(user_id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  auth_version integer NOT NULL DEFAULT 1 CHECK (auth_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT is_member_verified OR member_verification_revoked_at IS NULL),
  CHECK ((status = 'merged') = (merged_into_user_id IS NOT NULL)),
  CHECK (merged_into_user_id IS DISTINCT FROM user_id)
);

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  category text NOT NULL DEFAULT 'event' CHECK (category IN ('event','recruitment')),
  description text NOT NULL DEFAULT '',
  member_details text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  target text NOT NULL DEFAULT '',
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean NOT NULL DEFAULT false,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','members')),
  requires_member_verification boolean NOT NULL DEFAULT false,
  publication_status text NOT NULL DEFAULT 'draft' CHECK (publication_status IN ('draft','published','hidden')),
  lifecycle_status text NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active','cancelled','completed')),
  registration_enabled boolean NOT NULL DEFAULT false,
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  cancellation_closes_at timestamptz,
  source_promotion_id uuid REFERENCES promotions(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  cancelled_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR (starts_at IS NOT NULL AND ends_at >= starts_at)),
  CHECK (registration_opens_at IS NULL OR registration_closes_at IS NULL OR registration_closes_at > registration_opens_at),
  CHECK (NOT registration_enabled OR registration_closes_at IS NOT NULL),
  CHECK (NOT registration_enabled OR category = 'recruitment' OR starts_at IS NOT NULL),
  CHECK (category = 'recruitment' OR starts_at IS NULL OR registration_closes_at IS NULL OR registration_closes_at <= starts_at)
);

CREATE TABLE IF NOT EXISTS registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  participant_name text NOT NULL CHECK (char_length(participant_name) BETWEEN 1 AND 50),
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  attendance_status text NOT NULL DEFAULT 'unmarked' CHECK (attendance_status IN ('unmarked','present','absent')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  confirmation_code text NOT NULL DEFAULT upper(encode(gen_random_bytes(6),'hex')),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  checked_by text REFERENCES app_users(user_id) ON DELETE SET NULL,
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id,user_id),
  UNIQUE (event_id,confirmation_code),
  CHECK (status <> 'cancelled' OR attendance_status = 'unmarked')
);

CREATE INDEX IF NOT EXISTS events_public_order ON events (publication_status, visibility, starts_at, id);
CREATE INDEX IF NOT EXISTS events_promotion ON events (source_promotion_id) WHERE source_promotion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS registrations_user ON registrations (user_id,status,created_at DESC,id);
CREATE INDEX IF NOT EXISTS registrations_roster ON registrations (event_id,status,attendance_status,id);

-- Existing bulletin administrators remain administrators in the shared application.
INSERT INTO app_users (user_id,name,role)
  SELECT user_id,'','admin' FROM admin_users
  ON CONFLICT (user_id) DO UPDATE SET role='admin';
