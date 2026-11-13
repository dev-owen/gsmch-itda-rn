-- Internal synchronization metadata. USER, EVENT and REGISTRATION remain the business domains.
ALTER TABLE events ADD COLUMN IF NOT EXISTS source_system text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS source_id text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS source_identity_key text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS source_snapshot_identity_key text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS source_bulletin_id text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS source_bulletin_date text;
ALTER TABLE events ALTER COLUMN source_bulletin_date TYPE text USING source_bulletin_date::text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS sync_mode text NOT NULL DEFAULT 'manual';
ALTER TABLE events ADD COLUMN IF NOT EXISTS source_snapshot jsonb;
ALTER TABLE events ADD COLUMN IF NOT EXISTS source_review_required boolean NOT NULL DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS source_warnings jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE events ADD COLUMN IF NOT EXISTS source_pending boolean NOT NULL DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS source_missing boolean NOT NULL DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS source_synced_at timestamptz;
ALTER TABLE events ADD COLUMN IF NOT EXISTS source_sync_error text;
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_sync_mode_check;
ALTER TABLE events ADD CONSTRAINT events_sync_mode_check CHECK (sync_mode IN ('manual','automatic'));
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_source_snapshot_check;
ALTER TABLE events ADD CONSTRAINT events_source_snapshot_check CHECK (source_snapshot IS NULL OR jsonb_typeof(source_snapshot)='object');
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_source_warnings_check;
ALTER TABLE events ADD CONSTRAINT events_source_warnings_check CHECK (jsonb_typeof(source_warnings)='array');

-- A new bulletin can use a different advertisement ID for the same exact title and schedule.
CREATE TABLE IF NOT EXISTS event_source_aliases (
  source_system text NOT NULL,
  source_id text NOT NULL,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_system,source_id)
);
CREATE INDEX IF NOT EXISTS event_source_aliases_event ON event_source_aliases(event_id);
CREATE UNIQUE INDEX IF NOT EXISTS events_source_identity ON events(source_system,source_identity_key)
  WHERE source_system IS NOT NULL AND source_identity_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS event_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL CHECK (status IN ('success','failed','skipped')),
  trigger text NOT NULL CHECK (trigger IN ('scheduled','manual','cli')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created integer NOT NULL DEFAULT 0,
  updated integer NOT NULL DEFAULT 0,
  unchanged integer NOT NULL DEFAULT 0,
  pending integer NOT NULL DEFAULT 0,
  missing integer NOT NULL DEFAULT 0,
  error_code text,
  source_system text,
  source_bulletin_date text
);
ALTER TABLE event_sync_runs ADD COLUMN IF NOT EXISTS source_system text;
ALTER TABLE event_sync_runs ADD COLUMN IF NOT EXISTS source_bulletin_date text;
CREATE INDEX IF NOT EXISTS event_sync_runs_recent ON event_sync_runs(started_at DESC,id DESC);
