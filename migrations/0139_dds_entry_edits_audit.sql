ALTER TABLE dds_entries ADD COLUMN edit_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dds_entries ADD COLUMN last_edit_request_id TEXT;
ALTER TABLE dds_entries ADD COLUMN last_edited_by_user_id INTEGER;
ALTER TABLE dds_entries ADD COLUMN last_edited_at TEXT;
ALTER TABLE dds_entries ADD COLUMN last_edit_reason TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_dds_entry_last_edit_request
  ON dds_entries(last_edit_request_id) WHERE last_edit_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS dds_entry_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES dds_entries(id),
  edit_request_id TEXT NOT NULL UNIQUE,
  edit_version INTEGER NOT NULL,
  changed_by_user_id INTEGER NOT NULL,
  changed_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  old_amount INTEGER NOT NULL,
  new_amount INTEGER NOT NULL,
  old_business_date TEXT NOT NULL,
  new_business_date TEXT NOT NULL,
  old_category TEXT NOT NULL,
  new_category TEXT NOT NULL,
  old_article TEXT NOT NULL,
  new_article TEXT NOT NULL,
  old_comment TEXT NOT NULL,
  new_comment TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dds_entry_edits_entry
  ON dds_entry_edits(entry_id, id DESC);

CREATE TRIGGER IF NOT EXISTS dds_edit_cas_guard
BEFORE UPDATE ON dds_entries
BEGIN
  SELECT RAISE(ABORT,'DDS_EDIT_ONLY_ORIGINAL')
  WHERE OLD.kind NOT IN ('expense','funding')
    OR OLD.reverses_entry_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM dds_entries r WHERE r.reverses_entry_id=OLD.id);
  SELECT RAISE(ABORT,'DDS_EDIT_INVALID_METADATA')
  WHERE NEW.id IS NOT OLD.id OR NEW.request_id IS NOT OLD.request_id
    OR NEW.kind IS NOT OLD.kind OR NEW.reverses_entry_id IS NOT OLD.reverses_entry_id
    OR NEW.created_at IS NOT OLD.created_at
    OR NEW.created_by_user_id IS NOT OLD.created_by_user_id
    OR NEW.edit_version <> OLD.edit_version+1
    OR NEW.last_edit_request_id IS NULL
    OR LENGTH(TRIM(NEW.last_edit_request_id)) < 10
    OR NEW.last_edit_request_id IS OLD.last_edit_request_id
    OR NEW.last_edited_by_user_id IS NULL
    OR NEW.last_edited_at IS NULL
    OR LENGTH(TRIM(COALESCE(NEW.last_edit_reason,''))) < 3;
  SELECT RAISE(ABORT,'DDS_EDIT_INVALID_ARTICLE')
  WHERE NEW.kind='expense'
    AND (NEW.category IS NOT OLD.category OR NEW.article IS NOT OLD.article)
    AND NOT EXISTS (
      SELECT 1 FROM dds_articles a JOIN dds_categories c ON c.id=a.category_id
      WHERE c.name=NEW.category COLLATE NOCASE AND a.name=NEW.article COLLATE NOCASE
        AND c.is_active=1 AND a.is_active=1
    );
END;

CREATE TRIGGER IF NOT EXISTS dds_edit_audit
AFTER UPDATE ON dds_entries
BEGIN
  INSERT INTO dds_entry_edits(
    entry_id,edit_request_id,edit_version,changed_by_user_id,changed_at,reason,
    old_amount,new_amount,old_business_date,new_business_date,
    old_category,new_category,old_article,new_article,old_comment,new_comment
  ) VALUES (
    OLD.id,NEW.last_edit_request_id,NEW.edit_version,NEW.last_edited_by_user_id,
    NEW.last_edited_at,NEW.last_edit_reason,
    OLD.amount,NEW.amount,OLD.business_date,NEW.business_date,
    OLD.category,NEW.category,OLD.article,NEW.article,OLD.comment,NEW.comment
  );
END;

CREATE TRIGGER IF NOT EXISTS dds_edit_audit_immutable_update
BEFORE UPDATE ON dds_entry_edits
BEGIN
  SELECT RAISE(ABORT,'DDS_EDIT_AUDIT_IMMUTABLE');
END;
CREATE TRIGGER IF NOT EXISTS dds_edit_audit_immutable_delete
BEFORE DELETE ON dds_entry_edits
BEGIN
  SELECT RAISE(ABORT,'DDS_EDIT_AUDIT_IMMUTABLE');
END;
