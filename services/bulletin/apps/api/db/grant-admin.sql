-- Apply schema.sql and event-schema.sql first, then sign in with Google once.
-- psql -v admin_email='person@example.com' -f db/grant-admin.sql
-- One statement grants both authorization records atomically. Zero returned rows
-- means no matching Google-linked active account; inactive accounts stay inactive.
WITH approved AS (
  SELECT u.id, left(btrim(COALESCE(u.name, '')), 50) AS name
  FROM "user" u
  WHERE u.email = :'admin_email'
    AND EXISTS (SELECT 1 FROM "account" a WHERE a."userId" = u.id AND a."providerId" = 'google')
), members AS (
  INSERT INTO app_users (user_id, name, role)
  SELECT id, name, 'admin' FROM approved WHERE true
  ON CONFLICT (user_id) DO UPDATE SET
    role = 'admin',
    version = app_users.version + CASE WHEN app_users.role <> 'admin' THEN 1 ELSE 0 END,
    updated_at = CASE WHEN app_users.role <> 'admin' THEN now() ELSE app_users.updated_at END
  WHERE app_users.status = 'active'
  RETURNING user_id
), grants AS (
  INSERT INTO admin_users (user_id)
  SELECT user_id FROM members WHERE true
  ON CONFLICT (user_id) DO NOTHING
  RETURNING user_id
)
SELECT user_id, 'admin' AS role FROM members;
