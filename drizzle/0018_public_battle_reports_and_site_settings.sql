ALTER TABLE battle_report_generations ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE battle_report_generations ADD COLUMN public_since TEXT;
--> statement-breakpoint
ALTER TABLE battle_report_generations ADD COLUMN note TEXT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_battle_report_generations_public
  ON battle_report_generations(is_public, status, public_since DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_by_user_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
