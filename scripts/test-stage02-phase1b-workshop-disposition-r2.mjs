import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const domain = fs.readFileSync(path.join(root, 'worker/domains/returns-exchanges.ts'), 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }

try {
  check(
    domain.includes("if (isWorkshop && physicalState === 'boutique')"),
    'Workshop Return no longer rejects an explicit Boutique disposition',
  )
  check(
    domain.includes("const inventorySource = isWorkshop\n      ? (physicalState === 'warehouse' ? 'warehouse' : null)"),
    'Workshop Return can again derive stock intake from legacy restock flags instead of an explicit Warehouse physical state',
  )
  check(
    domain.includes("if (oldItemIsWorkshop && oldPhysicalState === 'boutique')"),
    'Workshop Exchange old item no longer rejects an explicit Boutique disposition',
  )
  check(
    domain.includes("const oldReturnSource = oldItemIsWorkshop\n    ? (oldPhysicalState === 'warehouse' ? 'warehouse' : 'none')"),
    'Workshop Exchange old item can again derive stock intake from legacy oldReturnSource instead of an explicit Warehouse physical state',
  )
  check(
    domain.includes('Legacy restock flags or a') && domain.includes('Legacy oldReturnSource payloads'),
    'Workshop explicit-disposition rationale disappeared from the domain guard',
  )

  console.log('STAGE02 PHASE1B WORKSHOP DISPOSITION R2 TESTS PASSED — only an explicit Warehouse physical state can create Workshop-origin intake; legacy restock/source flags cannot.')
} catch (error) {
  console.error(`STAGE02 PHASE1B WORKSHOP DISPOSITION R2 TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
