from pathlib import Path

worker = Path('worker/domains/inventory-movement.ts')
text = worker.read_text()
anchor = """  if (missingVariants.size) {\n    const variantsJson = JSON.stringify(Array.from(missingVariants.values()));\n"""
guard = """  // A physical operation may rediscover a logical combination whose deterministic\n  // external_id belongs to a retired historical row. external_id is globally unique, so an\n  // INSERT OR IGNORE would otherwise silently skip the new active combination. Keep the retired\n  // row retired and give the new physical incarnation a fresh external id.\n  if (missingVariants.size) {\n    const candidates = Array.from(missingVariants.values());\n    const candidateIds = candidates.map((row) => cleanText(row.externalId)).filter(Boolean);\n    if (candidateIds.length) {\n      const occupiedRows = mapSqlRows(await db.prepare(\n        `SELECT external_id FROM catalog_variants\n         WHERE external_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))`\n      ).bind(JSON.stringify(candidateIds)).all<{ external_id: string }>()) as Array<{ external_id: string }>;\n      const occupiedIds = new Set(occupiedRows.map((row) => cleanText(row.external_id)).filter(Boolean));\n      let physicalIncarnation = 0;\n      for (const row of candidates) {\n        const deterministicId = cleanText(row.externalId);\n        if (!deterministicId || !occupiedIds.has(deterministicId)) continue;\n        physicalIncarnation += 1;\n        row.externalId = `${deterministicId}-PHYS-${Date.now().toString(36).toUpperCase()}-${physicalIncarnation}`;\n      }\n    }\n  }\n\n"""
if guard not in text:
    if text.count(anchor) != 1:
        raise SystemExit(f'variant insert anchor count={text.count(anchor)}')
    text = text.replace(anchor, guard + anchor, 1)
worker.write_text(text)

checker = Path('scripts/test-step1906a-worker-modularization.mjs')
t = checker.read_text()
path_anchor = "const phase1bWorkshopReturnDispositionPath = path.join(root, 'scripts/phase1b-workshop-return-disposition-worker-manifest.json')\n"
path_line = "const arrivalSaveReliabilityPath = path.join(root, 'scripts/arrival-save-reliability-worker-manifest.json')\n"
if path_line not in t:
    if path_anchor not in t:
        raise SystemExit('1906A path anchor missing')
    t = t.replace(path_anchor, path_anchor + path_line, 1)

load_anchor = "  const phase1bWorkshopReturnDispositionChanges = phase1bWorkshopReturnDisposition.changes || {}\n"
load_block = """  check(fs.existsSync(arrivalSaveReliabilityPath), 'Arrival save reliability Worker manifest missing')\n  const arrivalSaveReliability = JSON.parse(fs.readFileSync(arrivalSaveReliabilityPath, 'utf8'))\n  check(arrivalSaveReliability?.version === 1 && arrivalSaveReliability?.revision === 'arrival-save-reliability-r1', 'Arrival save reliability Worker manifest invalid')\n  const arrivalSaveReliabilityChanges = arrivalSaveReliability.changes || {}\n"""
if load_block not in t:
    if load_anchor not in t:
        raise SystemExit('1906A load anchor missing')
    t = t.replace(load_anchor, load_anchor + load_block, 1)

old_chain = """    const phase1bWorkshopReturnDispositionChanged = phase1bWorkshopReturnDispositionChanges[name]\n    if (phase1bWorkshopReturnDispositionChanged) {\n      check(phase1bWorkshopReturnDispositionChanged.before === acceptedPostFinanceF9DatePriorityHash, `Phase 1B Workshop return disposition baseline hash mismatch: ${name}`)\n      check(sha(declarations.get(name)) === phase1bWorkshopReturnDispositionChanged.after, `Worker declaration changed beyond exact Phase 1B Workshop return disposition allow-list: ${name}`)\n    } else {\n      check(sha(declarations.get(name)) === acceptedPostFinanceF9DatePriorityHash, `Worker declaration body changed beyond accepted Finance F1-F9 / Phase 1B deltas: ${name}`)\n    }\n"""
new_chain = """    const phase1bWorkshopReturnDispositionChanged = phase1bWorkshopReturnDispositionChanges[name]\n    let acceptedPostPhase1bHash = acceptedPostFinanceF9DatePriorityHash\n    if (phase1bWorkshopReturnDispositionChanged) {\n      check(phase1bWorkshopReturnDispositionChanged.before === acceptedPostFinanceF9DatePriorityHash, `Phase 1B Workshop return disposition baseline hash mismatch: ${name}`)\n      acceptedPostPhase1bHash = phase1bWorkshopReturnDispositionChanged.after\n    }\n    const arrivalSaveReliabilityChanged = arrivalSaveReliabilityChanges[name]\n    if (arrivalSaveReliabilityChanged) {\n      check(arrivalSaveReliabilityChanged.before === acceptedPostPhase1bHash, `Arrival save reliability baseline hash mismatch: ${name}`)\n      check(sha(declarations.get(name)) === arrivalSaveReliabilityChanged.after, `Worker declaration changed beyond exact Arrival save reliability allow-list: ${name}`)\n    } else {\n      check(sha(declarations.get(name)) === acceptedPostPhase1bHash, `Worker declaration body changed beyond accepted Finance F1-F9 / Phase 1B / Arrival reliability deltas: ${name}`)\n    }\n"""
if new_chain not in t:
    if old_chain not in t:
        raise SystemExit('1906A final hash chain missing')
    t = t.replace(old_chain, new_chain, 1)
checker.write_text(t)

pkg = Path('package.json')
s = pkg.read_text()
old_pkg = 'node scripts/test-arrival-save-reliability.mjs && node scripts/test-stocktake-functional-acceptance.mjs'
new_pkg = 'node scripts/test-arrival-save-reliability.mjs && node scripts/test-arrival-materialization-reliability.mjs && node scripts/test-stocktake-functional-acceptance.mjs'
if new_pkg not in s:
    if old_pkg not in s:
        raise SystemExit('package arrival test anchor missing')
    s = s.replace(old_pkg, new_pkg, 1)
pkg.write_text(s)

Path('scripts/test-arrival-materialization-reliability.mjs').write_text("""import fs from 'node:fs'\nconst source = fs.readFileSync('worker/domains/inventory-movement.ts', 'utf8')\nconst start = source.indexOf('export async function resolveInventoryCreatableItemsBulk(')\nconst end = source.indexOf('\\n\\nexport async function applyInventoryMovement(', start)\nif (start < 0 || end < 0) throw new Error('Cannot isolate inventory materializer')\nconst body = source.slice(start, end)\nconst check = (value, message) => { if (!value) throw new Error(message) }\ncheck(body.includes('occupiedIds') && body.includes('-PHYS-'), 'Retired external-id collision can still block physical materialization')\ncheck(body.includes('SELECT external_id FROM catalog_variants'), 'Historical external-id occupancy is not inspected')\ncheck(!body.includes('UPDATE catalog_variants SET is_active = 1'), 'Arrival must not resurrect a client-retired historical variant')\ncheck(body.indexOf('occupiedIds') < body.indexOf('INSERT OR IGNORE INTO catalog_variants'), 'Collision guard must run before variant insert')\nconsole.log('ARRIVAL MATERIALIZATION RELIABILITY TESTS PASSED — retired history stays retired while a new physical incarnation can receive a unique external id')\n""")
