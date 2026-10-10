PRAGMA foreign_keys=ON;
-- Additive, empty audit for admin-chosen RETURN/WRITEOFF reason aliases.
-- Historical comments and all orders/inventory/money stay untouched.
CREATE TABLE IF NOT EXISTS reference_reason_choice_merges(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 kind TEXT NOT NULL CHECK(kind IN ('return_reason','writeoff_reason')),
 source_reference_id INTEGER NOT NULL UNIQUE REFERENCES reference_values(id),
 target_reference_id INTEGER NOT NULL REFERENCES reference_values(id),
 source_value TEXT NOT NULL CHECK(length(trim(source_value))>0),
 target_value TEXT NOT NULL CHECK(length(trim(target_value))>0),
 source_updated_at TEXT,
 target_updated_at TEXT,
 created_by TEXT NOT NULL CHECK(length(trim(created_by))>0),
 created_at TEXT NOT NULL,
 CHECK(source_reference_id<>target_reference_id)
);
CREATE INDEX IF NOT EXISTS idx_reference_reason_choice_target
 ON reference_reason_choice_merges(target_reference_id,created_at);
CREATE TABLE IF NOT EXISTS reference_reason_choice_validations(
 merge_id INTEGER PRIMARY KEY REFERENCES reference_reason_choice_merges(id),
 passed INTEGER NOT NULL CHECK(passed=1),
 checked_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS trg_reference_reason_choice_merge_no_update
 BEFORE UPDATE ON reference_reason_choice_merges
 BEGIN SELECT RAISE(ABORT,'Immutable reference reason alias'); END;
CREATE TRIGGER IF NOT EXISTS trg_reference_reason_choice_merge_no_delete
 BEFORE DELETE ON reference_reason_choice_merges
 BEGIN SELECT RAISE(ABORT,'Immutable reference reason alias'); END;
CREATE TRIGGER IF NOT EXISTS trg_reference_reason_choice_validation_no_update
 BEFORE UPDATE ON reference_reason_choice_validations
 BEGIN SELECT RAISE(ABORT,'Immutable reference reason validation'); END;
CREATE TRIGGER IF NOT EXISTS trg_reference_reason_choice_validation_no_delete
 BEFORE DELETE ON reference_reason_choice_validations
 BEGIN SELECT RAISE(ABORT,'Immutable reference reason validation'); END;
