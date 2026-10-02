import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

try {
  const section = read('src/features/sections/InventorySection.tsx')

  check(section.includes("const [stocktakeProductIndex, setStocktakeProductIndexState] = useState(0)"), 'Raw stocktake product index setter is not isolated')
  check(section.includes("const stocktakeProductKeyRef = useRef('')"), 'Selected stocktake product key is not persisted')
  check(section.includes("const stocktakeSessionIdRef = useRef('')"), 'Stocktake session identity is not tracked for navigation preservation')
  check(section.includes("const sameSession = stocktakeSessionIdRef.current === session.id"), 'Session refresh does not distinguish same-session navigation from a new stocktake')
  check(section.includes("const preferredProductKey = sameSession ? stocktakeProductKeyRef.current : ''"), 'Selected product is not preserved across same-session refresh')
  check(section.includes("setStocktakeProductIndexState(nextProductIndex)"), 'Session adoption still hard-resets navigation instead of restoring the selected product')
  check(section.includes("function setStocktakeProductIndex(next: number | ((current: number) => number))"), 'Stocktake navigation wrapper missing')
  check(section.includes("stocktakeProductKeyRef.current = stocktakeGroups[bounded]?.key || ''"), 'Manual next/previous/list navigation does not update the stable product key')
  check(section.includes("stocktakeProductKeyRef.current = stocktakeGroups[stocktakeProductIndex]?.key || ''"), 'Selected product key is not synchronized after group changes')
  check(!section.includes("stocktakeTouchedIds.current.clear()\n    setStocktakeProductIndex(0)"), 'Session adoption still resets the current product to the first group')

  console.log('STOCKTAKE NAVIGATION HOTFIX PASSED — partial counts may be left unfinished while moving between products, and same-session refreshes preserve the selected product.')
} catch (error) {
  console.error(`STOCKTAKE NAVIGATION HOTFIX FAILED: ${error?.message || error}`)
  process.exit(1)
}
