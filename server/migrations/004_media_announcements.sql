-- Image banners, admin announcements (broadcast notifications), push tokens.
ALTER TABLE banners ADD COLUMN IF NOT EXISTS image_url text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  url         text NOT NULL DEFAULT '',
  pushed      int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS announcements_created ON announcements (created_at DESC);

-- Expo push tokens (anonymous; no account needed to receive announcements).
CREATE TABLE IF NOT EXISTS push_tokens (
  token       text PRIMARY KEY,
  platform    text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now()
);
