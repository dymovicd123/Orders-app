from pathlib import Path


def replace_once(path, old, new, label):
    text = Path(path).read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    Path(path).write_text(text.replace(old, new, 1), encoding='utf-8')

# 1) Do not load the complete catalog merely by opening Warehouse overview/attention/history.
# Movement still loads it because the frozen Arrival workspace needs catalog variants.
replace_once(
    'src/App.tsx',
    "      void loadInventoryData('warehouse')\n      void loadInventoryData('boutique')\n      void loadCatalogData()\n      // Inventory admin forms must always use the canonical reference dictionaries.\n",
    "      void loadInventoryData('warehouse')\n      void loadInventoryData('boutique')\n      // Full catalog variants are intentionally lazy: overview/attention/history use inventory reads only.\n      // Movement keeps the full catalog available because the frozen Arrival workspace depends on it.\n      // Inventory admin forms must always use the canonical reference dictionaries.\n",
    'App general inventory catalog overfetch',
)
replace_once(
    'src/App.tsx',
    "  }, [activeSector, authReady, orderPanel, isAdmin])\n\n  useEffect(() => {\n    if (!authReady || isAdmin) return\n",
    "  }, [activeSector, authReady, orderPanel, isAdmin])\n\n  useEffect(() => {\n    if (!authReady || activeSector !== 'inventory') return\n    if (inventoryPanel === 'movement' || inventoryPanel === 'stocktake' || inventoryPanel === 'catalog') {\n      void loadCatalogData()\n    }\n  }, [activeSector, authReady, inventoryPanel])\n\n  useEffect(() => {\n    if (!authReady || isAdmin) return\n",
    'App catalog lazy panel effect',
)

# 2) Aggregate fallbacks only join dimensions actually referenced by the active filters.
replace_once(
    'worker/domains/orders-read.ts',
    "  const dateFrom = cleanText(url.searchParams.get('dateFrom'));\n  const dateTo = cleanText(url.searchParams.get('dateTo'));\n\n  // The visible list uses order_date. Cash cards use actual payment/return dates.\n",
    "  const dateFrom = cleanText(url.searchParams.get('dateFrom'));\n  const dateTo = cleanText(url.searchParams.get('dateTo'));\n  let aggregateNeedsManagerJoin = false;\n  let aggregateNeedsCustomerJoin = false;\n\n  // The visible list uses order_date. Cash cards use actual payment/return dates.\n",
    'orders aggregate join flags',
)
replace_once(
    'worker/domains/orders-read.ts',
    "  } else if (manager) {\n    baseWhereParts.push(\"UPPER(COALESCE(m.name, o.manager_snapshot_name, '')) = ?\");\n    baseBindings.push(manager);\n\n  }\n",
    "  } else if (manager) {\n    aggregateNeedsManagerJoin = true;\n    baseWhereParts.push(\"UPPER(COALESCE(m.name, o.manager_snapshot_name, '')) = ?\");\n    baseBindings.push(manager);\n\n  }\n",
    'orders manager aggregate dependency',
)
replace_once(
    'worker/domains/orders-read.ts',
    "    } else {\n      const searchOrderText = `COALESCE(o.external_id, '') || ' ' || COALESCE(o.order_date, '') || ' ' ||\n",
    "    } else {\n      aggregateNeedsManagerJoin = true;\n      aggregateNeedsCustomerJoin = true;\n      const searchOrderText = `COALESCE(o.external_id, '') || ' ' || COALESCE(o.order_date, '') || ' ' ||\n",
    'orders generic search aggregate dependencies',
)
replace_once(
    'worker/domains/orders-read.ts',
    "  const joins = `\n\n    FROM orders o\n    LEFT JOIN managers m ON m.id = o.manager_id\n    LEFT JOIN customers c ON c.id = o.customer_id`;\n\n  const rows = await db.prepare(`\n",
    "  const joins = `\n\n    FROM orders o\n    LEFT JOIN managers m ON m.id = o.manager_id\n    LEFT JOIN customers c ON c.id = o.customer_id`;\n  const aggregateJoins = `\n    FROM orders o\n    ${aggregateNeedsManagerJoin ? 'LEFT JOIN managers m ON m.id = o.manager_id' : ''}\n    ${aggregateNeedsCustomerJoin ? 'LEFT JOIN customers c ON c.id = o.customer_id' : ''}`;\n\n  const rows = await db.prepare(`\n",
    'orders aggregate minimal joins',
)
replace_once(
    'worker/domains/orders-read.ts',
    "      ${joins}\n      LEFT JOIN (\n        SELECT order_id, COALESCE(SUM(quantity), 0) AS workshop_units\n",
    "      ${aggregateJoins}\n      LEFT JOIN (\n        SELECT order_id, COALESCE(SUM(quantity), 0) AS workshop_units\n",
    'order stats minimal joins',
)
replace_once(
    'worker/domains/orders-read.ts',
    "        JOIN orders o ON o.id = p.order_id\n        LEFT JOIN managers m ON m.id = o.manager_id\n        LEFT JOIN customers c ON c.id = o.customer_id\n        ${paymentWhereParts.length ? `WHERE ${paymentWhereParts.join(' AND ')}` : ''}\n",
    "        JOIN orders o ON o.id = p.order_id\n        ${aggregateNeedsManagerJoin ? 'LEFT JOIN managers m ON m.id = o.manager_id' : ''}\n        ${aggregateNeedsCustomerJoin ? 'LEFT JOIN customers c ON c.id = o.customer_id' : ''}\n        ${paymentWhereParts.length ? `WHERE ${paymentWhereParts.join(' AND ')}` : ''}\n",
    'payment stats minimal joins',
)
replace_once(
    'worker/domains/orders-read.ts',
    "        JOIN orders o ON o.id = r.order_id\n        LEFT JOIN managers m ON m.id = o.manager_id\n        LEFT JOIN customers c ON c.id = o.customer_id\n        ${returnWhereParts.length ? `WHERE ${returnWhereParts.join(' AND ')}` : ''}\n",
    "        JOIN orders o ON o.id = r.order_id\n        ${aggregateNeedsManagerJoin ? 'LEFT JOIN managers m ON m.id = o.manager_id' : ''}\n        ${aggregateNeedsCustomerJoin ? 'LEFT JOIN customers c ON c.id = o.customer_id' : ''}\n        ${returnWhereParts.length ? `WHERE ${returnWhereParts.join(' AND ')}` : ''}\n",
    'return stats minimal joins',
)

# Permanent regression.
Path('scripts/test-d1-read-budget-r4.mjs').write_text(r'''import fs from 'node:fs'

const read = (p) => fs.readFileSync(p, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const app = read('src/App.tsx')
const orders = read('worker/domains/orders-read.ts')

const generalInventoryBlock = app.slice(
  app.indexOf("if (activeSector === 'inventory') {"),
  app.indexOf("if (activeSector === 'orders' && (orderPanel === 'create' || orderPanel === 'edit'))"),
)
check(!generalInventoryBlock.includes('loadCatalogData()'), 'Warehouse overview still eagerly loads the full catalog')
check(app.includes("inventoryPanel === 'movement' || inventoryPanel === 'stocktake' || inventoryPanel === 'catalog'"), 'Catalog is not lazy-loaded for panels that require variants')
check(app.includes("if (activeSector === 'orders' && (orderPanel === 'create' || orderPanel === 'edit'))"), 'Order editor/create catalog safeguard missing')
check(app.includes("void loadCatalogData()\n    }\n  }, [activeSector, authReady, inventoryPanel])"), 'Inventory catalog panel effect missing')

check(orders.includes('let aggregateNeedsManagerJoin = false;'), 'Order aggregate manager join flag missing')
check(orders.includes('let aggregateNeedsCustomerJoin = false;'), 'Order aggregate customer join flag missing')
check(orders.includes("${aggregateNeedsManagerJoin ? 'LEFT JOIN managers m ON m.id = o.manager_id' : ''}"), 'Order aggregate still always joins managers')
check(orders.includes("${aggregateNeedsCustomerJoin ? 'LEFT JOIN customers c ON c.id = o.customer_id' : ''}"), 'Order aggregate still always joins customers')
check(orders.includes('aggregateNeedsManagerJoin = true;\n      aggregateNeedsCustomerJoin = true;\n      const searchOrderText'), 'Generic order search no longer enables required dimension joins')
check(orders.includes('aggregateNeedsManagerJoin = true;\n    baseWhereParts.push("UPPER(COALESCE(m.name'), 'Manager-name filter no longer enables manager join')
check(orders.includes('${aggregateJoins}\n      LEFT JOIN ('), 'Order summary fallback still uses full display joins')

console.log('D1 READ BUDGET R4 PASSED — Warehouse overview avoids full catalog scans and order aggregate fallbacks skip unused dimension joins')
''', encoding='utf-8')

package = Path('package.json').read_text(encoding='utf-8')
old = 'node scripts/test-d1-read-budget-r3.mjs && node scripts/test-operational-autonomy-r2.mjs'
new = 'node scripts/test-d1-read-budget-r3.mjs && node scripts/test-d1-read-budget-r4.mjs && node scripts/test-operational-autonomy-r2.mjs'
if package.count(old) != 1:
    raise SystemExit(f'package release chain: expected one R3 marker, got {package.count(old)}')
Path('package.json').write_text(package.replace(old, new, 1), encoding='utf-8')

print('D1 R4 patch applied')
