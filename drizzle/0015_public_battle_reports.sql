ALTER TABLE battle_report_generations ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;
ALTER TABLE battle_report_generations ADD COLUMN public_since TEXT;

CREATE INDEX IF NOT EXISTS idx_battle_report_generations_public
  ON battle_report_generations(is_public, status, public_since DESC);
