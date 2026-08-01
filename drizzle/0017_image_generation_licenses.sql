CREATE TABLE IF NOT EXISTS image_generation_licenses (
  id TEXT PRIMARY KEY NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  max_uses INTEGER NOT NULL,
  remaining_uses INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_by_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS image_generation_licenses_key_hash_unique
  ON image_generation_licenses(key_hash);
CREATE INDEX IF NOT EXISTS image_generation_licenses_expires_at_idx
  ON image_generation_licenses(expires_at);
CREATE INDEX IF NOT EXISTS image_generation_licenses_revoked_at_idx
  ON image_generation_licenses(revoked_at);
