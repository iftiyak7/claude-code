-- Admin panel support: activity tracking and account suspension.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_sync_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
CREATE INDEX IF NOT EXISTS users_created_at ON users (created_at);
