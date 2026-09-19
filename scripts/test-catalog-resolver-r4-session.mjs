import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const modal = fs.readFileSync(path.join(root, 'src/features/orders/OrderCatalogResolutionModal.tsx'), 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }

try {
  check(
    modal.includes('previewPending.current = false') &&
    modal.includes('mutationPending.current = false') &&
    modal.includes('setResolving(false)'),
    'Resolver order-switch effect does not clear pending activity from the previous order',
  )
  check(
    !modal.includes("if (!variantId && !isAdmin) return"),
    'Safe missing-combination action can still silently no-op for a manager',
  )
  check(
    modal.includes("const needsAdminCatalogMutation = !variantId && Boolean(next.createProduct || next.createFields?.length || legacy)"),
    'Privileged catalog mutations are no longer distinguished from safe existing-fact resolution',
  )
  check(
    modal.includes("if (needsAdminCatalogMutation && !isAdmin) throw new Error"),
    'Admin-only catalog mutations lost their explicit guard',
  )

  console.log('CATALOG RESOLVER R4 SESSION TESTS PASSED — a second order cannot inherit the previous resolver latch, and safe manager resolution no longer silently returns.')
} catch (error) {
  console.error(`CATALOG RESOLVER R4 SESSION TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
