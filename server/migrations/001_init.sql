-- Tadbeer Daily — initial schema

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  name          text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));

-- Opaque refresh tokens (only a SHA-256 hash is stored). Tokens rotate on
-- every use; presenting an already-rotated token revokes the whole family.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family      uuid NOT NULL,
  token_hash  bytea NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_tokens_user ON refresh_tokens (user_id);

-- Every synced entity, opaque JSON per user. `seq` is a server-assigned,
-- monotonically increasing change number used as the pull cursor.
CREATE SEQUENCE IF NOT EXISTS records_seq;
CREATE TABLE IF NOT EXISTS records (
  user_id     uuid   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection  text   NOT NULL,
  id          text   NOT NULL,
  data        jsonb  NOT NULL,
  updated_at  bigint NOT NULL,
  deleted     boolean NOT NULL DEFAULT false,
  seq         bigint NOT NULL DEFAULT nextval('records_seq'),
  PRIMARY KEY (user_id, collection, id)
);
CREATE INDEX IF NOT EXISTS records_user_seq ON records (user_id, seq);
