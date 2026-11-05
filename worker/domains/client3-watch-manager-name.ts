/** Match the order ledger: preserve historical manager name, then resolve by manager id. */
export const watchManagerReportNameSql =
  "COALESCE(NULLIF(TRIM(o.manager_snapshot_name),''),"+
  "(SELECT NULLIF(TRIM(m.name),'') FROM managers m WHERE m.id=o.manager_id LIMIT 1),"+
  "'НЕ УКАЗАН')"
