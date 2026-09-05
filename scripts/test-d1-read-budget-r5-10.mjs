import fs from 'node:fs'
const workshop = fs.readFileSync('worker/domains/workshop.ts', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
try {
  check(!workshop.includes('WORKSHOP_SET_FALLBACK_MIN_ITEMS'), 'R5.10 must not add top-level Worker declarations')
  check(workshop.includes('if (directItemIds.length >= 20) {'), 'large Workshop read threshold missing')
  check(workshop.includes("FROM catalog_variants\n           WHERE product_id IN ("), 'set-based catalog fetch missing')
  check(workshop.includes('ORDER BY product_id ASC, is_active DESC, sort_order ASC, id ASC'), 'legacy fallback priority must be preserved')
  const split = workshop.indexOf('// R5.10: only large read-side enrichments')
  const fallback = workshop.indexOf('const directLinkCountByKey', split)
  const block = workshop.slice(split, fallback)
  check(block.includes('} else if (directItemIds.length) {'), 'small-flow boundary missing')
  check(block.includes('LEFT JOIN catalog_variants cv_fallback ON cv_fallback.id = ('), 'small-flow legacy fallback must remain')
  const laterFallback = workshop.indexOf('let fallbackMatches = new Map', fallback)
  const laterEnd = workshop.indexOf('return taskRows.map', laterFallback)
  check(workshop.slice(laterFallback, laterEnd).includes('LEFT JOIN catalog_variants cv_fallback ON cv_fallback.id = ('), 'ambiguous task matching must remain unchanged')
  console.log('R5.10 WORKSHOP READ BUDGET PASSED — large enrichment is set-based; small mutation/relink and ambiguous matching retain legacy SQL')
} catch (error) {
  console.error(`R5.10 WORKSHOP READ BUDGET FAILED: ${error?.message || error}`)
  process.exit(1)
}
