import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const check = (condition, message) => { if (!condition) throw new Error(message) }

const workshopSource = fs.readFileSync('worker/domains/workshop.ts', 'utf8')
const appSource = fs.readFileSync('src/App.tsx', 'utf8')
const financeHookSource = fs.readFileSync('src/features/finance/useFinanceReportReads.ts', 'utf8')
const activitySource = fs.readFileSync('worker/domains/activity.ts', 'utf8')

// R7.4 — one visible Workshop aggregation instead of four status scans.
const workshopCountsStart = workshopSource.indexOf('export async function readWorkshopCounts')
const workshopCountsEnd = workshopSource.indexOf('\n\n\nexport async function listWorkshopTasks', workshopCountsStart)
check(workshopCountsStart >= 0 && workshopCountsEnd > workshopCountsStart, 'R7.4 Workshop counts function not found')
const workshopCountsSource = workshopSource.slice(workshopCountsStart, workshopCountsEnd)
check(workshopCountsSource.includes('hidden_task_ids AS MATERIALIZED'), 'R7.4 hidden task set must be materialized once')
check(workshopCountsSource.includes('LEFT JOIN hidden_task_ids hidden ON hidden.workshop_task_id = wt.id'), 'R7.4 visible aggregation must exclude the exact hidden task ids')
check(workshopCountsSource.includes("SUM(CASE WHEN wt.status = 'active'"), 'R7.4 active counter must be folded into the shared aggregation')
check(workshopCountsSource.includes("SUM(CASE WHEN wt.status IN ('done', 'ready')"), 'R7.4 done/ready counter must be folded into the shared aggregation')
check(!workshopCountsSource.includes("(SELECT COUNT(*) FROM workshop_tasks WHERE status = 'active')"), 'R7.4 old standalone active count scan returned')
check(!workshopCountsSource.includes("(SELECT COUNT(*) FROM workshop_tasks WHERE status = 'done')"), 'R7.4 old standalone done count scan returned')
check(!workshopCountsSource.includes("(SELECT COUNT(*) FROM workshop_tasks WHERE status = 'ready')"), 'R7.4 old standalone ready count scan returned')

const db = new DatabaseSync(':memory:')
db.exec(`
  CREATE TABLE orders(id INTEGER PRIMARY KEY, order_status TEXT);
  CREATE TABLE workshop_tasks(
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL,
    order_item_id INTEGER,
    status TEXT NOT NULL,
    urgent INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE returns(id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, status TEXT);
  CREATE TABLE exchanges(id INTEGER PRIMARY KEY, refund_return_id INTEGER, status TEXT);
  CREATE TABLE return_items(id INTEGER PRIMARY KEY, return_id INTEGER NOT NULL, order_item_id INTEGER);
  CREATE TABLE return_workshop_task_reversals(
    return_id INTEGER NOT NULL,
    workshop_task_id INTEGER NOT NULL,
    previous_status TEXT,
    previous_quantity INTEGER
  );

  INSERT INTO orders VALUES
    (1,'active'),(2,'archived'),(3,'active'),(4,'active'),(5,'active'),(6,'deleted'),(7,'active');

  INSERT INTO workshop_tasks VALUES
    (101,1,11,'active',1),
    (102,1,12,'done',0),
    (103,2,21,'active',0),
    (104,3,31,'active',0),
    (105,4,41,'ready',0),
    (106,5,51,'active',1),
    (107,6,61,'done',0),
    (108,1,13,'ready',0),
    (109,7,71,'active',0),
    (110,7,72,'done',0);

  INSERT INTO returns VALUES
    (201,3,'completed'),
    (202,4,'completed'),
    (203,5,'completed'),
    (204,7,'completed');
  INSERT INTO return_items VALUES
    (301,201,31),
    (302,202,41),
    (303,203,51),
    (304,204,NULL);
  INSERT INTO return_workshop_task_reversals VALUES (202,105,'active',1);
  INSERT INTO exchanges VALUES (401,203,'completed');
`)

const standaloneReturnCte = `
standalone_return_orders AS (
  SELECT wr.id AS return_id, wr.order_id
  FROM returns wr
  WHERE COALESCE(wr.status, 'completed') <> 'cancelled'
    AND NOT EXISTS (
      SELECT 1
      FROM exchanges we
      WHERE we.refund_return_id = wr.id
        AND COALESCE(we.status, 'completed') <> 'cancelled'
    )
),
hidden_return_workshop_tasks AS (
  SELECT DISTINCT wt_hidden.id AS workshop_task_id
  FROM standalone_return_orders wr
  JOIN return_items wri ON wri.return_id = wr.return_id
  JOIN workshop_tasks wt_hidden ON wt_hidden.order_id = wr.order_id
  WHERE (
      wri.order_item_id IS NULL
      OR wri.order_item_id = wt_hidden.order_item_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM return_workshop_task_reversals rwt
      WHERE rwt.return_id = wr.return_id
        AND rwt.workshop_task_id = wt_hidden.id
    )
)`

const oldSql = `WITH ${standaloneReturnCte},
 hidden_task_ids AS (
   SELECT wt.id AS workshop_task_id
   FROM workshop_tasks wt
   JOIN orders o ON o.id = wt.order_id
   WHERE o.order_status IN ('deleted', 'archived')
   UNION
   SELECT workshop_task_id FROM hidden_return_workshop_tasks
 ),
 hidden_counts AS (
   SELECT
     COALESCE(SUM(CASE WHEN wt.status = 'active' THEN 1 ELSE 0 END), 0) AS active_count,
     COALESCE(SUM(CASE WHEN wt.status = 'active' AND wt.urgent = 1 THEN 1 ELSE 0 END), 0) AS urgent_count,
     COALESCE(SUM(CASE WHEN wt.status IN ('done', 'ready') THEN 1 ELSE 0 END), 0) AS done_count
   FROM hidden_task_ids hidden
   JOIN workshop_tasks wt ON wt.id = hidden.workshop_task_id
 )
 SELECT
   MAX(0, (SELECT COUNT(*) FROM workshop_tasks WHERE status = 'active') - COALESCE(hidden_counts.active_count, 0)) AS active_count,
   MAX(0, (SELECT COUNT(*) FROM workshop_tasks WHERE status = 'active' AND urgent = 1) - COALESCE(hidden_counts.urgent_count, 0)) AS urgent_count,
   MAX(0, (SELECT COUNT(*) FROM workshop_tasks WHERE status = 'done')
     + (SELECT COUNT(*) FROM workshop_tasks WHERE status = 'ready')
     - COALESCE(hidden_counts.done_count, 0)) AS done_count
 FROM hidden_counts`

const nextSql = `WITH ${standaloneReturnCte},
 hidden_task_ids AS MATERIALIZED (
   SELECT wt.id AS workshop_task_id
   FROM workshop_tasks wt
   JOIN orders o ON o.id = wt.order_id
   WHERE o.order_status IN ('deleted', 'archived')
   UNION
   SELECT workshop_task_id FROM hidden_return_workshop_tasks
 )
 SELECT
   COALESCE(SUM(CASE WHEN wt.status = 'active' THEN 1 ELSE 0 END), 0) AS active_count,
   COALESCE(SUM(CASE WHEN wt.status = 'active' AND wt.urgent = 1 THEN 1 ELSE 0 END), 0) AS urgent_count,
   COALESCE(SUM(CASE WHEN wt.status IN ('done', 'ready') THEN 1 ELSE 0 END), 0) AS done_count
 FROM workshop_tasks wt
 LEFT JOIN hidden_task_ids hidden ON hidden.workshop_task_id = wt.id
 WHERE hidden.workshop_task_id IS NULL`

const oldCounts = db.prepare(oldSql).get()
const nextCounts = db.prepare(nextSql).get()
check(JSON.stringify(nextCounts) === JSON.stringify(oldCounts), 'R7.4 Workshop count semantics changed: ' + JSON.stringify({ oldCounts, nextCounts }))
check(Number(nextCounts.active_count) === 2, 'R7.4 fixture active count is wrong')
check(Number(nextCounts.urgent_count) === 2, 'R7.4 fixture urgent count is wrong')
check(Number(nextCounts.done_count) === 3, 'R7.4 fixture done count is wrong')

// R7.5 — bounded read snapshot for order forms, while writes remain server-authoritative.
check(appSource.includes('const INVENTORY_FORM_SNAPSHOT_TTL_MS = 30_000'), 'R7.5 bounded inventory snapshot TTL missing')
check(appSource.includes('const inventorySnapshotLoadedAt = useRef<Record<InventorySourceKey, number>>'), 'R7.5 per-source inventory freshness clock missing')
check(appSource.includes('snapshotAgeMs <= INVENTORY_FORM_SNAPSHOT_TTL_MS'), 'R7.5 inventory cache is not time-bounded')
check(appSource.includes("if (!query.trim()) inventorySnapshotLoadedAt.current[source] = Date.now()"), 'R7.5 filtered searches must not mark the full inventory snapshot fresh')
check(appSource.includes('inventorySnapshotLoadedAt.current = { warehouse: 0, boutique: 0 }'), 'R7.5 stock mutation invalidation must clear snapshot freshness')
const orderFormEffectMarker = "(activeSector === 'orders' && (orderPanel === 'create' || orderPanel === 'edit' || orderPanel === 'exchange')) || (activeSector === 'kaspi' && orderPanel === 'zammler')"
const orderFormEffectStart = appSource.indexOf(orderFormEffectMarker)
const orderFormEffectEnd = appSource.indexOf('\n    }', orderFormEffectStart)
const orderFormEffect = appSource.slice(orderFormEffectStart, orderFormEffectEnd)
check(orderFormEffect.includes("loadInventoryData('warehouse', false, '', false)"), 'R7.5 order forms still force Warehouse scan')
check(orderFormEffect.includes("loadInventoryData('boutique', false, '', false)"), 'R7.5 order forms still force Boutique scan')
check(appSource.includes("loadInventoryData('warehouse', true, '', false)"), 'R7.5 accidentally removed explicit post-mutation/stocktake refresh paths')

// R7.6 — cross-navigation reuse only from a full exact finance overview.
check(financeHookSource.includes('const ORDERS_SUMMARY_TTL_MS = 2 * 60 * 1000'), 'R7.6 Orders summary TTL missing')
check(financeHookSource.includes('function ordersSummaryFromFinanceReport(data: FinanceReportResponse)'), 'R7.6 exact Finance-to-Orders summary projection missing')
check(financeHookSource.includes('if (!reportType && data.overview) {'), 'R7.6 must reuse only a complete full/Finance overview, never a specialized partial payload')
check(financeHookSource.includes('summaryCache.current.set(summaryKey, { data: ordersSummaryFromFinanceReport(data), savedAt })'), 'R7.6 Finance result is not priming Orders summary cache')
check(activitySource.includes('WHERE order_date BETWEEN ? AND ?'), 'R7.6 sales must remain based on order_date')
check(activitySource.includes('WHERE p.payment_date BETWEEN ? AND ?'), 'R7.6 receipts must remain based on payment_date')
check(activitySource.includes('WHERE r.return_date BETWEEN ? AND ?'), 'R7.6 returns must remain based on return_date')

// R7.7 — passive Attention counts are bounded and a detail read supplies its own exact summary.
check(appSource.includes('const WAREHOUSE_ATTENTION_SUMMARY_TTL_MS = 60_000'), 'R7.7 Attention summary TTL missing')
check(appSource.includes('data: { ok: data.ok, total: data.total, counts: data.counts }'), 'R7.7 detailed Attention read does not prime the summary cache')
check(appSource.includes('warehouseAttentionSummaryCache = null'), 'R7.7 local inventory mutations must still invalidate Attention truth')

db.close()
console.log('D1 READ BUDGET R7.4-R7.7 PASSED — Workshop counts preserve hidden-return semantics; order forms, Finance summary and Warehouse Attention reuse only bounded/exact read results')
