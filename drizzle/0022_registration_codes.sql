CREATE TABLE IF NOT EXISTS registration_codes (
  id TEXT PRIMARY KEY NOT NULL,
  code_hash TEXT NOT NULL,
  code_prefix TEXT NOT NULL,
  max_uses INTEGER NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0,
  claimed_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_by_admin_principal_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS registration_codes_code_hash_unique ON registration_codes(code_hash);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS registration_codes_expires_at_idx ON registration_codes(expires_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS registration_codes_revoked_at_idx ON registration_codes(revoked_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS registration_code_claims (
  id TEXT PRIMARY KEY NOT NULL,
  code_id TEXT NOT NULL,
  status TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS registration_code_claims_code_status_idx
  ON registration_code_claims(code_id, status, expires_at);
