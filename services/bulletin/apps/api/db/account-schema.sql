-- Apply after Better Auth's generated schema and db/event-schema.sql.
-- This is authentication operation/audit storage, not a fourth business domain.
CREATE TABLE IF NOT EXISTS auth_account_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('merge','delete')),
  owner_user_id text NOT NULL,
  source_user_id text,
  request_key text NOT NULL CHECK (char_length(request_key) BETWEEN 8 AND 128),
  token_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','awaiting_approval','approved','completed','cancelled')),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (owner_user_id,kind,request_key),
  CHECK (source_user_id IS NULL OR source_user_id <> owner_user_id)
);
CREATE INDEX IF NOT EXISTS auth_account_operations_owner ON auth_account_operations(owner_user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS auth_account_operations_expiry ON auth_account_operations(expires_at) WHERE status NOT IN ('completed','cancelled');

-- Better Auth's generated PostgreSQL schema uses these exact camelCase names.
-- Existing sessions have no provider proof and must sign in again for sensitive actions.
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "authVersion" integer NOT NULL DEFAULT 1;
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "authProviderId" text NOT NULL DEFAULT '';

-- Every auth-library write must participate in the same USER lock/version protocol
-- as registration and merge transactions, including OAuth callback writes.
CREATE OR REPLACE FUNCTION auth_account_lock_member() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  member_id text;
BEGIN
  FOR member_id IN
    SELECT DISTINCT value FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD."userId" ELSE NULL END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW."userId" ELSE NULL END
    ]) AS ids(value) WHERE value IS NOT NULL ORDER BY value
  LOOP
    PERFORM user_id FROM app_users WHERE user_id=member_id FOR UPDATE;
    IF TG_OP <> 'DELETE' AND member_id=NEW."userId" AND EXISTS (
      SELECT 1 FROM app_users WHERE user_id=member_id AND status <> 'active'
    ) THEN RAISE EXCEPTION 'Inactive application account' USING ERRCODE='42501'; END IF;
    UPDATE app_users SET version=version+1,updated_at=now() WHERE user_id=member_id;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
DROP TRIGGER IF EXISTS auth_account_member_lock ON "account";
CREATE TRIGGER auth_account_member_lock BEFORE INSERT OR UPDATE OR DELETE ON "account"
  FOR EACH ROW EXECUTE FUNCTION auth_account_lock_member();
