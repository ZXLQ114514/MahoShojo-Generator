PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE image_generation_licenses_v2 (
  id TEXT PRIMARY KEY NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  max_uses INTEGER NOT NULL,
  remaining_uses INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_by_user_id INTEGER,
  created_by_admin_principal_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
--> statement-breakpoint
INSERT INTO image_generation_licenses_v2 (
  id, key_hash, key_prefix, max_uses, remaining_uses, expires_at,
  created_by_user_id, created_by_admin_principal_id, created_at, updated_at,
  last_used_at, revoked_at
)
SELECT id, key_hash, key_prefix, max_uses, remaining_uses, expires_at,
  created_by_user_id, NULL, created_at, updated_at, last_used_at, revoked_at
FROM image_generation_licenses;
--> statement-breakpoint
DROP TABLE image_generation_licenses;
--> statement-breakpoint
ALTER TABLE image_generation_licenses_v2 RENAME TO image_generation_licenses;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS image_generation_licenses_key_hash_unique ON image_generation_licenses(key_hash);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS image_generation_licenses_expires_at_idx ON image_generation_licenses(expires_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS image_generation_licenses_revoked_at_idx ON image_generation_licenses(revoked_at);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
