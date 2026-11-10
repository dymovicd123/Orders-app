-- Branch2: planned shifts (team_timesheet) and actual attendance are intentionally independent.
-- Existing schedules, salary preview and attendance_days are not modified.
CREATE TABLE IF NOT EXISTS team_attendance_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_date TEXT NOT NULL CHECK(length(work_date)=10),
  manager_id INTEGER NOT NULL REFERENCES managers(id),
  status TEXT NOT NULL CHECK(status IN ('present','absent','excused')),
  finished_at TEXT CHECK(finished_at IS NULL OR
    (length(finished_at)=5 AND finished_at GLOB '[0-2][0-9]:[0-5][0-9]' AND substr(finished_at,1,2)<='23')),
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_user_id INTEGER,
  UNIQUE(work_date,manager_id),
  CHECK(status='present' OR finished_at IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_team_attendance_month ON team_attendance_marks(work_date,manager_id);

-- Automatic row-level audit: even a corrected or cleared mark remains traceable.
CREATE TABLE IF NOT EXISTS team_attendance_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mark_id INTEGER NOT NULL,
  work_date TEXT NOT NULL,
  manager_id INTEGER NOT NULL,
  change_kind TEXT NOT NULL CHECK(change_kind IN ('created','updated','cleared')),
  previous_status TEXT,
  new_status TEXT,
  previous_finished_at TEXT,
  new_finished_at TEXT,
  previous_comment TEXT,
  new_comment TEXT,
  actor_user_id INTEGER,
  changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_team_attendance_changes_day ON team_attendance_changes(work_date,manager_id,id);

CREATE TRIGGER IF NOT EXISTS team_attendance_audit_insert
AFTER INSERT ON team_attendance_marks BEGIN
  INSERT INTO team_attendance_changes
    (mark_id,work_date,manager_id,change_kind,previous_status,new_status,
     new_finished_at,new_comment,actor_user_id,changed_at)
  VALUES(NEW.id,NEW.work_date,NEW.manager_id,'created',NULL,NEW.status,
         NEW.finished_at,NEW.comment,NEW.updated_by_user_id,NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS team_attendance_audit_update
AFTER UPDATE ON team_attendance_marks
WHEN OLD.status<>NEW.status OR COALESCE(OLD.finished_at,'')<>COALESCE(NEW.finished_at,'')
     OR OLD.comment<>NEW.comment
BEGIN
  INSERT INTO team_attendance_changes
    (mark_id,work_date,manager_id,change_kind,previous_status,new_status,
     previous_finished_at,new_finished_at,previous_comment,new_comment,actor_user_id,changed_at)
  VALUES(NEW.id,NEW.work_date,NEW.manager_id,'updated',OLD.status,NEW.status,
         OLD.finished_at,NEW.finished_at,OLD.comment,NEW.comment,NEW.updated_by_user_id,NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS team_attendance_audit_delete
AFTER DELETE ON team_attendance_marks BEGIN
  INSERT INTO team_attendance_changes
    (mark_id,work_date,manager_id,change_kind,previous_status,previous_finished_at,
     previous_comment,actor_user_id,changed_at)
  VALUES(OLD.id,OLD.work_date,OLD.manager_id,'cleared',OLD.status,OLD.finished_at,
         OLD.comment,OLD.updated_by_user_id,datetime('now'));
END;
