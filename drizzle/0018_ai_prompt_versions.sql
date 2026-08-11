CREATE TABLE IF NOT EXISTS ai_prompt_versions (
  id TEXT PRIMARY KEY NOT NULL,
  prompt_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  body TEXT NOT NULL,
  action TEXT NOT NULL,
  change_note TEXT NOT NULL,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL,
  previous_revision TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_prompt_versions_prompt_revision_unique
  ON ai_prompt_versions(prompt_id, revision);
CREATE INDEX IF NOT EXISTS ai_prompt_versions_prompt_created_at_idx
  ON ai_prompt_versions(prompt_id, created_at);
CREATE INDEX IF NOT EXISTS ai_prompt_versions_created_by_idx
  ON ai_prompt_versions(created_by_user_id, created_at);
