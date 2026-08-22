PRAGMA foreign_keys = ON;

-- Step 14: Сымбат / администраторы не должны попадать в табель назначений.
-- Сотрудник остаётся в команде, но прошлые назначения в табеле очищаются.
DELETE FROM team_timesheet
WHERE manager_id IN (
  SELECT id
  FROM managers
  WHERE UPPER(COALESCE(name, '')) LIKE '%СЫМБАТ%'
     OR UPPER(COALESCE(role, '')) LIKE '%АДМИНИСТРАТОР%'
);
