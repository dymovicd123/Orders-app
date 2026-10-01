import fs from 'node:fs'
import ts from 'typescript'
import { DatabaseSync } from 'node:sqlite'

const check = (condition, message) => { if (!condition) throw new Error(message) }
const sourceText = fs.readFileSync('worker/domains/clients.ts', 'utf8')
check(sourceText.includes('const cte = clientStatsCte(true);'), 'R7.3 list must materialize the shared client stats graph')
check(sourceText.includes("stats AS${materializeStats ? ' MATERIALIZED' : ''} ("), 'R7.3 materialized stats switch missing')
check(!/const \[summary, rows\] = await Promise\.all\(\[\s*getClientsSummary\(db\)/.test(sourceText), 'R7.3 list still rebuilds full client history for a separate summary request')
check(sourceText.includes('summary.filtered_count'), 'R7.3 exact filtered count must come from the shared materialized stats query')
check(sourceText.includes('LEFT JOIN filtered ON 1 = 1'), 'R7.3 combined query must still return summary when the filtered page is empty')
check(sourceText.includes('resultRows.filter((row) => toInt(row.id, 0) > 0)'), 'R7.3 summary sentinel must not become a fake client row')

const compiled = ts.transpileModule(sourceText.replace(/^import .*\r?\n/gm, ''), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const module = { exports: {} }
new Function(
  'module','exports','json','mapSqlRows','cleanText','normalizePhone','toInt','normalizeManagerColor','fetchOrderRelations','workshopTaskStatusForOrderItem',
  compiled,
)(
  module,module.exports,
  (value) => value,
  (result) => result?.results || [],
  (value) => String(value ?? '').trim(),
  (value) => String(value ?? '').replace(/\D/g, ''),
  (value, fallback = 0) => { const parsed = Number.parseInt(String(value ?? ''), 10); return Number.isFinite(parsed) ? parsed : fallback },
  (value) => String(value || '#475569'),
  async () => ({}),
  () => '',
)
const { clientStatsCte, buildClientWhere, clientOrderBy } = module.exports

const db = new DatabaseSync(':memory:')
db.exec(`
  CREATE TABLE customers(
    id INTEGER PRIMARY KEY, phone_normalized TEXT, display_name TEXT, city TEXT,
    first_order_at TEXT, last_order_at TEXT, orders_count INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1
  );
  CREATE TABLE managers(id INTEGER PRIMARY KEY, name TEXT, color_key TEXT);
  CREATE TABLE orders(
    id INTEGER PRIMARY KEY, customer_id INTEGER, manager_id INTEGER, manager_snapshot_name TEXT,
    order_date TEXT, total_amount INTEGER, received_amount INTEGER, debt_amount INTEGER, return_amount INTEGER,
    order_status TEXT, city TEXT
  );
  CREATE TABLE retained_order_summaries(
    original_order_id INTEGER, customer_id INTEGER, manager_id INTEGER, manager_name TEXT,
    order_date TEXT, total_amount INTEGER, received_amount INTEGER, debt_amount INTEGER, return_amount INTEGER, city TEXT
  );

  INSERT INTO managers VALUES (1,'Алия','#111111'),(2,'Дана','#222222');
  INSERT INTO customers(id,phone_normalized,display_name,city,is_active) VALUES
    (1,'77010000001','Амина','Алматы',1),
    (2,'77010000002','Бота','Астана',1),
    (3,'77010000003','Без заказов','Шымкент',1),
    (4,'77010000004','Гуль','Караганда',1);

  INSERT INTO orders VALUES
    (101,1,1,'Алия','2026-09-01',10000,8000,2000,0,'active','Алматы'),
    (102,1,2,'Дана','2026-09-03',20000,20000,0,1000,'closed','Астана'),
    (201,2,1,'Алия','2026-09-02',15000,5000,10000,0,'active','Астана'),
    (202,2,1,'Алия','2026-09-04',99999,99999,0,0,'deleted','Астана');

  INSERT INTO retained_order_summaries VALUES
    (401,4,2,'Дана','2026-08-15',7000,7000,0,0,'Караганда'),
    (101,1,1,'Алия','2026-09-01',10000,8000,2000,0,'Алматы');
`)

const oldSummarySql = (cte) => `${cte}
  SELECT COUNT(*) AS total_clients,
         SUM(CASE WHEN order_count >= 2 THEN 1 ELSE 0 END) AS repeat_clients,
         SUM(CASE WHEN debt_amount > 0 THEN 1 ELSE 0 END) AS debt_clients,
         COALESCE(SUM(debt_amount), 0) AS total_debt,
         COALESCE(SUM(total_amount), 0) AS total_sales,
         COALESCE(SUM(received_amount), 0) AS total_received,
         COALESCE(SUM(return_amount), 0) AS total_returns,
         COALESCE(SUM(order_count), 0) AS order_count,
         COALESCE(SUM(archived_order_count), 0) AS archived_order_count,
         COALESCE(SUM(active_order_count), 0) AS active_order_count
  FROM stats WHERE order_count > 0`

function oldPage(mode, q, limit, offset) {
  const { whereSql, bindings } = buildClientWhere(mode, q)
  const cte = clientStatsCte()
  return db.prepare(`${cte}
    SELECT COUNT(*) OVER() AS filtered_count, id, order_count, total_amount, received_amount, debt_amount,
           return_amount, first_order_at, last_order_at, active_order_count, archived_order_count
    FROM stats WHERE ${whereSql}
    ORDER BY ${clientOrderBy(mode)} LIMIT ? OFFSET ?`).all(...bindings, limit, offset)
}

function combined(mode, q, limit, offset) {
  const { whereSql, bindings } = buildClientWhere(mode, q)
  const cte = clientStatsCte(true)
  return db.prepare(`${cte},
    summary AS (
      SELECT
        COALESCE(SUM(CASE WHEN order_count > 0 THEN 1 ELSE 0 END), 0) AS total_clients,
        COALESCE(SUM(CASE WHEN order_count >= 2 THEN 1 ELSE 0 END), 0) AS repeat_clients,
        COALESCE(SUM(CASE WHEN order_count > 0 AND debt_amount > 0 THEN 1 ELSE 0 END), 0) AS debt_clients,
        COALESCE(SUM(CASE WHEN order_count > 0 THEN debt_amount ELSE 0 END), 0) AS total_debt,
        COALESCE(SUM(CASE WHEN order_count > 0 THEN total_amount ELSE 0 END), 0) AS total_sales,
        COALESCE(SUM(CASE WHEN order_count > 0 THEN received_amount ELSE 0 END), 0) AS total_received,
        COALESCE(SUM(CASE WHEN order_count > 0 THEN return_amount ELSE 0 END), 0) AS total_returns,
        COALESCE(SUM(CASE WHEN order_count > 0 THEN order_count ELSE 0 END), 0) AS order_count,
        COALESCE(SUM(CASE WHEN order_count > 0 THEN archived_order_count ELSE 0 END), 0) AS archived_order_count,
        COALESCE(SUM(CASE WHEN order_count > 0 THEN active_order_count ELSE 0 END), 0) AS active_order_count,
        COALESCE(SUM(CASE WHEN ${whereSql} THEN 1 ELSE 0 END), 0) AS filtered_count
      FROM stats
    ),
    filtered AS (
      SELECT ROW_NUMBER() OVER (ORDER BY ${clientOrderBy(mode)}) AS page_order,
             id, order_count, total_amount, received_amount, debt_amount, return_amount,
             first_order_at, last_order_at, active_order_count, archived_order_count
      FROM stats WHERE ${whereSql}
      ORDER BY ${clientOrderBy(mode)} LIMIT ? OFFSET ?
    )
    SELECT
      summary.total_clients AS summary_total_clients,
      summary.repeat_clients AS summary_repeat_clients,
      summary.debt_clients AS summary_debt_clients,
      summary.total_debt AS summary_total_debt,
      summary.total_sales AS summary_total_sales,
      summary.total_received AS summary_total_received,
      summary.total_returns AS summary_total_returns,
      summary.order_count AS summary_order_count,
      summary.archived_order_count AS summary_archived_order_count,
      summary.active_order_count AS summary_active_order_count,
      summary.filtered_count,
      filtered.*
    FROM summary LEFT JOIN filtered ON 1=1
    ORDER BY COALESCE(filtered.page_order, 0)`).all(...bindings, ...bindings, limit, offset)
}

const summary = db.prepare(oldSummarySql(clientStatsCte())).get()
for (const scenario of [
  { mode: 'all', q: '', limit: 2, offset: 0 },
  { mode: 'repeat', q: '', limit: 10, offset: 0 },
  { mode: 'debt', q: '', limit: 10, offset: 0 },
  { mode: 'all', q: 'Амина', limit: 10, offset: 0 },
  { mode: 'all', q: 'нет-совпадения', limit: 10, offset: 0 },
  { mode: 'all', q: '', limit: 2, offset: 50 },
]) {
  const old = oldPage(scenario.mode, scenario.q, scenario.limit, scenario.offset)
  const next = combined(scenario.mode, scenario.q, scenario.limit, scenario.offset)
  check(next.length >= 1, 'R7.3 combined query lost the summary sentinel')
  const nextRows = next.filter((row) => Number(row.id || 0) > 0)
  check(JSON.stringify(nextRows.map((row) => Number(row.id))) === JSON.stringify(old.map((row) => Number(row.id))), 'R7.3 client page ordering/identity changed: ' + JSON.stringify(scenario))
  const oldFiltered = old.length ? Number(old[0].filtered_count || 0) : db.prepare(`${clientStatsCte()} SELECT COUNT(*) AS n FROM stats WHERE ${buildClientWhere(scenario.mode, scenario.q).whereSql}`).get(...buildClientWhere(scenario.mode, scenario.q).bindings).n
  check(Number(next[0].filtered_count || 0) === Number(oldFiltered || 0), 'R7.3 filtered count changed: ' + JSON.stringify(scenario))
  for (const key of ['total_clients','repeat_clients','debt_clients','total_debt','total_sales','total_received','total_returns','order_count','archived_order_count','active_order_count']) {
    check(Number(next[0][`summary_${key}`] || 0) === Number(summary[key] || 0), `R7.3 global summary changed (${key}): ${JSON.stringify(scenario)}`)
  }
}

db.close()
console.log('D1 READ BUDGET R7.3 PASSED — Clients list and global cards share one materialized history graph with exact page/count/summary parity, including empty and out-of-range pages')
