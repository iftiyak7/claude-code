-- Home-screen banners managed from the admin panel (shown to everyone).
CREATE TABLE IF NOT EXISTS banners (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tag         text NOT NULL DEFAULT '',
  body        text NOT NULL,
  arabic      text NOT NULL DEFAULT '',
  source      text NOT NULL DEFAULT '',
  theme       text NOT NULL DEFAULT 'coral',
  cta_label   text NOT NULL DEFAULT '',
  cta_url     text NOT NULL DEFAULT '',
  active      boolean NOT NULL DEFAULT true,
  sort        int NOT NULL DEFAULT 0,
  starts_at   timestamptz,
  ends_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS banners_active ON banners (active, sort);
