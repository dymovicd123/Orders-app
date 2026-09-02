from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


def replace_in_section(path, start, end, old, new, label):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    a = text.find(start)
    if a < 0: raise SystemExit(f'{label}: start marker missing')
    b = text.find(end, a)
    if b < 0: raise SystemExit(f'{label}: end marker missing')
    section = text[a:b]
    if section.count(old) != 1:
        raise SystemExit(f'{label}: expected one section match, got {section.count(old)}')
    p.write_text(text[:a] + section.replace(old, new, 1) + text[b:], encoding='utf-8')

# Frontend: keep the existing hook and frozen Arrival UI; only defer the full catalog scan
# until a Warehouse panel that actually needs catalog variants is active.
replace_once('src/App.tsx',
    "      void loadInventoryData('warehouse')\n      void loadInventoryData('boutique')\n      void loadCatalogData()\n      // Inventory admin forms must always use the canonical reference dictionaries.\n",
    "      void loadInventoryData('warehouse')\n      void loadInventoryData('boutique')\n      // Full catalog variants are unnecessary for ordinary Остатки/Внимание/История reads.\n      // Movement keeps them because the frozen Arrival workspace depends on catalog variants.\n      if (inventoryPanel === 'movement' || inventoryPanel === 'stocktake' || inventoryPanel === 'catalog') void loadCatalogData()\n      // Inventory admin forms must always use the canonical reference dictionaries.\n",
    'App inventory catalog overfetch')
replace_once('src/App.tsx',
    "  }, [activeSector, authReady, orderPanel, isAdmin])\n",
    "  }, [activeSector, authReady, orderPanel, isAdmin, inventoryPanel])\n",
    'App inventory panel dependency')

# Worker: fallback period aggregates only join dimensions referenced by the active filters.
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
replace_in_section('worker/domains/orders-read.ts', "SELECT COUNT(p.id) AS payment_count", ").bind(...paymentBindings)",
    "        LEFT JOIN managers m ON m.id = o.manager_id\n        LEFT JOIN customers c ON c.id = o.customer_id\n", minimal_dims, 'payment aggregate joins')
replace_in_section('worker/domains/orders-read.ts', "SELECT COUNT(r.id) AS return_count", ").bind(...returnBindings)",
    "        LEFT JOIN managers m ON m.id = o.manager_id\n        LEFT JOIN customers c ON c.id = o.customer_id\n", minimal_dims, 'return aggregate joins')

# Extend 1906A preservation with a proper post-order-edit R4 chain.
replace_once('scripts/test-step1906a-worker-modularization.mjs',
    "const d1ReadBudgetR3Path = path.join(root, 'scripts/d1-read-budget-r3-worker-manifest.json')\nconst orderEditScopeR1Path = path.join(root, 'scripts/order-edit-scope-r1-worker-manifest.json')\n",
    "const d1ReadBudgetR3Path = path.join(root, 'scripts/d1-read-budget-r3-worker-manifest.json')\nconst orderEditScopeR1Path = path.join(root, 'scripts/order-edit-scope-r1-worker-manifest.json')\nconst d1ReadBudgetR4Path = path.join(root, 'scripts/d1-read-budget-r4-worker-manifest.json')\n",
    '1906A R4 manifest path')
replace_once('scripts/test-step1906a-worker-modularization.mjs',
    "  const orderEditScopeR1Changes = orderEditScopeR1.changes || {}\n  check(fs.existsSync(operationalAutonomyR2WorkerPath), 'Operational autonomy R2 Worker manifest missing')\n",
    "  const orderEditScopeR1Changes = orderEditScopeR1.changes || {}\n  check(fs.existsSync(d1ReadBudgetR4Path), 'D1 read-budget R4 Worker manifest missing')\n  const d1ReadBudgetR4 = JSON.parse(fs.readFileSync(d1ReadBudgetR4Path, 'utf8'))\n  check(d1ReadBudgetR4?.version === 1 && d1ReadBudgetR4?.revision === 'd1-read-budget-r4', 'D1 read-budget R4 Worker manifest invalid')\n  const d1ReadBudgetR4Changes = d1ReadBudgetR4.changes || {}\n  check(fs.existsSync(operationalAutonomyR2WorkerPath), 'Operational autonomy R2 Worker manifest missing')\n",
    '1906A R4 manifest load')
replace_once('scripts/test-step1906a-worker-modularization.mjs',
    "    const orderEditScopeR1Changed = orderEditScopeR1Changes[name]\n    if (orderEditScopeR1Changed) {\n      check(orderEditScopeR1Changed.before === acceptedPostD1ReadBudgetR3Hash, `Order edit scope R1 baseline hash mismatch: ${name}`)\n      check(sha(declarations.get(name)) === orderEditScopeR1Changed.after, `Worker declaration changed beyond exact order edit scope R1 allow-list: ${name}`)\n    } else {\n      check(sha(declarations.get(name)) === acceptedPostD1ReadBudgetR3Hash, `Worker declaration body changed beyond accepted cumulative deltas: ${name}`)\n    }\n",
    "    const orderEditScopeR1Changed = orderEditScopeR1Changes[name]\n    let acceptedPostOrderEditScopeHash = acceptedPostD1ReadBudgetR3Hash\n    if (orderEditScopeR1Changed) {\n      check(orderEditScopeR1Changed.before === acceptedPostD1ReadBudgetR3Hash, `Order edit scope R1 baseline hash mismatch: ${name}`)\n      acceptedPostOrderEditScopeHash = orderEditScopeR1Changed.after\n    }\n    const d1ReadBudgetR4Changed = d1ReadBudgetR4Changes[name]\n    if (d1ReadBudgetR4Changed) {\n      check(d1ReadBudgetR4Changed.before === acceptedPostOrderEditScopeHash, `D1 read-budget R4 baseline hash mismatch: ${name}`)\n      check(sha(declarations.get(name)) === d1ReadBudgetR4Changed.after, `Worker declaration changed beyond exact D1 read-budget R4 allow-list: ${name}`)\n    } else {\n      check(sha(declarations.get(name)) === acceptedPostOrderEditScopeHash, `Worker declaration body changed beyond accepted cumulative deltas: ${name}`)\n    }\n",
    '1906A R4 final hash chain')

Path('scripts/test-d1-read-budget-r4.mjs').write_text(r'''import fs from 'node:fs'
const read = (p) => fs.readFileSync(p, 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }
const app = read('src/App.tsx')
const orders = read('worker/domains/orders-read.ts')
check(app.includes("if (inventoryPanel === 'movement' || inventoryPanel === 'stocktake' || inventoryPanel === 'catalog') void loadCatalogData()"), 'Warehouse catalog lazy gate missing')
check(app.includes("}, [activeSector, authReady, orderPanel, isAdmin, inventoryPanel])"), 'Warehouse catalog gate does not react to panel changes')
check(app.includes("if (activeSector === 'orders' && (orderPanel === 'create' || orderPanel === 'edit'))"), 'Order create/editor catalog path missing')
check(orders.includes('let aggregateNeedsManagerJoin = false;') && orders.includes('let aggregateNeedsCustomerJoin = false;'), 'Aggregate dependency flags missing')
check(orders.includes('aggregateNeedsManagerJoin = true;\n      aggregateNeedsCustomerJoin = true;\n      const searchOrderText'), 'Generic search dimension dependencies missing')
check(orders.includes('aggregateNeedsManagerJoin = true;\n    baseWhereParts.push("UPPER(COALESCE(m.name'), 'Manager filter dependency missing')
check(orders.includes("${aggregateNeedsManagerJoin ? 'LEFT JOIN managers m ON m.id = o.manager_id' : ''}"), 'Conditional manager join missing')
check(orders.includes("${aggregateNeedsCustomerJoin ? 'LEFT JOIN customers c ON c.id = o.customer_id' : ''}"), 'Conditional customer join missing')
check(orders.includes('${aggregateJoins}\n      LEFT JOIN ('), 'Order stats fallback still uses display joins')
console.log('D1 READ BUDGET R4 PASSED — ordinary Warehouse views avoid full catalog scans and aggregate fallbacks skip unused dimension joins')
''', encoding='utf-8')

p = Path('package.json')
text = p.read_text(encoding='utf-8')
old = 'node scripts/test-d1-read-budget-r3.mjs && node scripts/test-operational-autonomy-r2.mjs'
if text.count(old) != 1: raise SystemExit('package R3 chain marker missing or duplicated')
p.write_text(text.replace(old, 'node scripts/test-d1-read-budget-r3.mjs && node scripts/test-d1-read-budget-r4.mjs && node scripts/test-operational-autonomy-r2.mjs', 1), encoding='utf-8')
print('D1 R4 v3 patch applied')
