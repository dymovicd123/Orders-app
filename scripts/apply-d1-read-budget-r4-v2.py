from pathlib import Path


def replace_once(path, old, new, label):
    text = Path(path).read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    Path(path).write_text(text.replace(old, new, 1), encoding='utf-8')


def replace_in_section(path, start, end, old, new, label):
    text = Path(path).read_text(encoding='utf-8')
    a = text.find(start)
    if a < 0: raise SystemExit(f'{label}: start marker missing')
    b = text.find(end, a)
    if b < 0: raise SystemExit(f'{label}: end marker missing')
    section = text[a:b]
    if section.count(old) != 1:
        raise SystemExit(f'{label}: expected one section match, got {section.count(old)}')
    section = section.replace(old, new, 1)
    Path(path).write_text(text[:a] + section + text[b:], encoding='utf-8')

replace_once('src/App.tsx',
    "      void loadInventoryData('warehouse')\n      void loadInventoryData('boutique')\n      void loadCatalogData()\n      // Inventory admin forms must always use the canonical reference dictionaries.\n",
    "      void loadInventoryData('warehouse')\n      void loadInventoryData('boutique')\n      // Full catalog variants are lazy here: overview/attention/history only need inventory reads.\n      // Movement still loads the catalog because the frozen Arrival workspace depends on variants.\n      // Inventory admin forms must always use the canonical reference dictionaries.\n",
    'App general inventory catalog overfetch')
replace_once('src/App.tsx',
    "  }, [activeSector, authReady, orderPanel, isAdmin])\n\n  useEffect(() => {\n    if (!authReady || isAdmin) return\n",
    "  }, [activeSector, authReady, orderPanel, isAdmin])\n\n  useEffect(() => {\n    if (!authReady || activeSector !== 'inventory') return\n    if (inventoryPanel === 'movement' || inventoryPanel === 'stocktake' || inventoryPanel === 'catalog') {\n      void loadCatalogData()\n    }\n  }, [activeSector, authReady, inventoryPanel])\n\n  useEffect(() => {\n    if (!authReady || isAdmin) return\n",
    'App catalog lazy panel effect')

replace_once('worker/domains/orders-read.ts',
    "  const dateFrom = cleanText(url.searchParams.get('dateFrom'));\n  const dateTo = cleanText(url.searchParams.get('dateTo'));\n\n  // The visible list uses order_date. Cash cards use actual payment/return dates.\n",
    "  const dateFrom = cleanText(url.searchParams.get('dateFrom'));\n  const dateTo = cleanText(url.searchParams.get('dateTo'));\n  let aggregateNeedsManagerJoin = false;\n  let aggregateNeedsCustomerJoin = false;\n\n  // The visible list uses order_date. Cash cards use actual payment/return dates.\n",
    'orders aggregate flags')
replace_once('worker/domains/orders-read.ts',
    "  } else if (manager) {\n    baseWhereParts.push(\"UPPER(COALESCE(m.name, o.manager_snapshot_name, '')) = ?\");\n",
    "  } else if (manager) {\n    aggregateNeedsManagerJoin = true;\n    baseWhereParts.push(\"UPPER(COALESCE(m.name, o.manager_snapshot_name, '')) = ?\");\n",
    'orders manager dependency')
replace_once('worker/domains/orders-read.ts',
    "    } else {\n      const searchOrderText = `COALESCE(o.external_id, '') || ' ' || COALESCE(o.order_date, '') || ' ' ||\n",
    "    } else {\n      aggregateNeedsManagerJoin = true;\n      aggregateNeedsCustomerJoin = true;\n      const searchOrderText = `COALESCE(o.external_id, '') || ' ' || COALESCE(o.order_date, '') || ' ' ||\n",
    'orders generic search dependencies')
replace_once('worker/domains/orders-read.ts',
    "  const joins = `\n\n    FROM orders o\n    LEFT JOIN managers m ON m.id = o.manager_id\n    LEFT JOIN customers c ON c.id = o.customer_id`;\n\n  const rows = await db.prepare(`\n",
    "  const joins = `\n\n    FROM orders o\n    LEFT JOIN managers m ON m.id = o.manager_id\n    LEFT JOIN customers c ON c.id = o.customer_id`;\n  const aggregateJoins = `\n    FROM orders o\n    ${aggregateNeedsManagerJoin ? 'LEFT JOIN managers m ON m.id = o.manager_id' : ''}\n    ${aggregateNeedsCustomerJoin ? 'LEFT JOIN customers c ON c.id = o.customer_id' : ''}`;\n\n  const rows = await db.prepare(`\n",
    'orders aggregate joins')
replace_once('worker/domains/orders-read.ts',
    "      ${joins}\n      LEFT JOIN (\n        SELECT order_id, COALESCE(SUM(quantity), 0) AS workshop_units\n",
    "      ${aggregateJoins}\n      LEFT JOIN (\n        SELECT order_id, COALESCE(SUM(quantity), 0) AS workshop_units\n",
    'order stats joins')

minimal_dims = "        ${aggregateNeedsManagerJoin ? 'LEFT JOIN managers m ON m.id = o.manager_id' : ''}\n        ${aggregateNeedsCustomerJoin ? 'LEFT JOIN customers c ON c.id = o.customer_id' : ''}\n"
replace_in_section('worker/domains/orders-read.ts',
    "SELECT COUNT(p.id) AS payment_count", ").bind(...paymentBindings)",
    "        LEFT JOIN managers m ON m.id = o.manager_id\n        LEFT JOIN customers c ON c.id = o.customer_id\n",
    minimal_dims, 'payment aggregate dimension joins')
replace_in_section('worker/domains/orders-read.ts',
    "SELECT COUNT(r.id) AS return_count", ").bind(...returnBindings)",
    "        LEFT JOIN managers m ON m.id = o.manager_id\n        LEFT JOIN customers c ON c.id = o.customer_id\n",
    minimal_dims, 'return aggregate dimension joins')

Path('scripts/test-d1-read-budget-r4.mjs').write_text(r'''import fs from 'node:fs'
const read = (p) => fs.readFileSync(p, 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }
const app = read('src/App.tsx')
const orders = read('worker/domains/orders-read.ts')
const inventoryStart = app.indexOf("if (activeSector === 'inventory') {")
const ordersStart = app.indexOf("if (activeSector === 'orders' && (orderPanel === 'create' || orderPanel === 'edit'))", inventoryStart)
const generalInventoryBlock = app.slice(inventoryStart, ordersStart)
check(inventoryStart >= 0 && ordersStart > inventoryStart, 'Warehouse load block not found')
check(!generalInventoryBlock.includes('loadCatalogData()'), 'Warehouse overview still eagerly loads the full catalog')
check(app.includes("inventoryPanel === 'movement' || inventoryPanel === 'stocktake' || inventoryPanel === 'catalog'"), 'Catalog lazy panel gate missing')
check(app.includes("void loadCatalogData()\n    }\n  }, [activeSector, authReady, inventoryPanel])"), 'Catalog lazy panel effect missing')
check(app.includes("if (activeSector === 'orders' && (orderPanel === 'create' || orderPanel === 'edit'))"), 'Order create/editor catalog path missing')
check(orders.includes('let aggregateNeedsManagerJoin = false;') && orders.includes('let aggregateNeedsCustomerJoin = false;'), 'Aggregate join dependency flags missing')
check(orders.includes('aggregateNeedsManagerJoin = true;\n      aggregateNeedsCustomerJoin = true;\n      const searchOrderText'), 'Generic search dimension dependency missing')
check(orders.includes('aggregateNeedsManagerJoin = true;\n    baseWhereParts.push("UPPER(COALESCE(m.name'), 'Manager filter dependency missing')
check(orders.includes("${aggregateNeedsManagerJoin ? 'LEFT JOIN managers m ON m.id = o.manager_id' : ''}"), 'Conditional manager aggregate join missing')
check(orders.includes("${aggregateNeedsCustomerJoin ? 'LEFT JOIN customers c ON c.id = o.customer_id' : ''}"), 'Conditional customer aggregate join missing')
check(orders.includes('${aggregateJoins}\n      LEFT JOIN ('), 'Order stats fallback still uses display joins')
console.log('D1 READ BUDGET R4 PASSED — Warehouse overview skips full catalog reads and order aggregate fallbacks skip unused dimension joins')
''', encoding='utf-8')

p = Path('package.json')
text = p.read_text(encoding='utf-8')
old = 'node scripts/test-d1-read-budget-r3.mjs && node scripts/test-operational-autonomy-r2.mjs'
if text.count(old) != 1: raise SystemExit('package R3 chain marker missing or duplicated')
p.write_text(text.replace(old, 'node scripts/test-d1-read-budget-r3.mjs && node scripts/test-d1-read-budget-r4.mjs && node scripts/test-operational-autonomy-r2.mjs', 1), encoding='utf-8')
print('D1 R4 patch applied')
