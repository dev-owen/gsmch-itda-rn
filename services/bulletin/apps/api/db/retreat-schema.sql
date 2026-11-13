ALTER TABLE app_users ADD COLUMN IF NOT EXISTS peer_group text;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS phone_number text;
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_peer_group_check;
ALTER TABLE app_users ADD CONSTRAINT app_users_peer_group_check CHECK (peer_group IS NULL OR char_length(peer_group) BETWEEN 1 AND 30);
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_gender_check;
ALTER TABLE app_users ADD CONSTRAINT app_users_gender_check CHECK (gender IS NULL OR gender IN ('male','female','other'));
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_phone_number_check;
ALTER TABLE app_users ADD CONSTRAINT app_users_phone_number_check CHECK (phone_number IS NULL OR phone_number ~ '^\+?[0-9]{8,15}$');

ALTER TABLE events ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS retreat_answers jsonb;
ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_retreat_answers_check;
ALTER TABLE registrations ADD CONSTRAINT registrations_retreat_answers_check CHECK (retreat_answers IS NULL OR jsonb_typeof(retreat_answers)='object');
