import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

function resolveLocal(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromFile), specifier)
  const candidates = /\.[cm]?[jt]sx?$/.test(base)
    ? [base]
    : ['.ts', '.tsx', '.js', '.jsx'].flatMap((ext) => [`${base}${ext}`, path.join(base, `index${ext}`)])
  return candidates.find((candidate) => fs.existsSync(candidate)) || null
}

function staticSourceGraph(entryRelative) {
  const entry = path.join(root, entryRelative)
  const queue = [entry]
  const seen = new Set()
  while (queue.length) {
    const file = queue.pop()
    if (!file || seen.has(file)) continue
    seen.add(file)
    const text = fs.readFileSync(file, 'utf8')
    const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
    for (const statement of source.statements) {
      let specifier = null
      if (ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly && ts.isStringLiteral(statement.moduleSpecifier)) specifier = statement.moduleSpecifier.text
      if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) specifier = statement.moduleSpecifier.text
      if (!specifier) continue
      const target = resolveLocal(file, specifier)
      if (target && !seen.has(target)) queue.push(target)
    }
  }
  return seen
}

try {
  const lazyRelative = 'src/app/lazySections.tsx'
  const appRelative = 'src/App.tsx'
  const mainRelative = 'src/main.tsx'
  const lazy = read(lazyRelative)
  const app = read(appRelative)
  const main = read(mainRelative)
  const worker = read('worker/index.ts')

  const lazySections = [
    'DashboardSection','ClientsSection','ReferencesSection','InventorySection','WorkshopSection',
    'OrdersHeaderSection','OrderFiltersSection','CreateOrderSection','OrderEditorSection','OrdersTableSection',
    'OrderDetailsSection','OrderDebtSection','OrderReturnsSection','OrderExchangeSection','TeamSection','LeadsSection',
    'PlanSection','FinanceSection','ReportsSection','OrderActivitySection',
  ]
  for (const name of lazySections) {
    check(lazy.includes(`export const ${name} = namedLazy(`), `Lazy feature boundary missing: ${name}`)
    check(app.includes(`<${name} `), `App no longer renders lazy feature: ${name}`)
  }
  check((lazy.match(/= namedLazy\(/g) || []).length === lazySections.length, `Expected ${lazySections.length} lazy sections`)
  check(lazy.includes('function DeferredSection'), 'DeferredSection wrapper missing')
  check(lazy.includes('const [activated, setActivated] = useState(active)'), 'DeferredSection no longer preserves first-mount state')
  check(lazy.includes('if (!active && !activated) return null'), 'DeferredSection loads inactive chunks eagerly')
  check(lazy.includes('<Suspense'), 'Lazy sections are missing Suspense fallback')
  check(!lazy.includes('@ts-nocheck'), 'Lazy boundary disables type checking')

  for (const name of lazySections) {
    check(!new RegExp(`from ['\"][^'\"]*features/sections/${name}['\"]`).test(app), `App statically imports ${name}`)
  }
  check(!app.includes("from './features/renderers/FinanceDashboardRenderer'"), 'Finance dashboard renderer still leaks into initial App graph')
  check(!app.includes("from './features/renderers/FinanceReportContentRenderer'"), 'Finance report renderer still leaks into initial App graph')
  check(app.includes("useState<AppSector>(() => sectorFromHash(window.location.hash))"), 'Direct hash routes still mount the default Orders chunk before the requested sector')
  check(read('src/features/sections/FinanceSection.tsx').includes("from '../renderers/FinanceDashboardRenderer'"), 'Finance renderer is not colocated behind Finance lazy boundary')
  check(read('src/features/sections/ReportsSection.tsx').includes("from '../renderers/FinanceReportContentRenderer'"), 'Report renderer is not colocated behind Reports lazy boundary')

  const graph = staticSourceGraph(mainRelative)
  const graphRelative = [...graph].map((file) => path.relative(root, file).replace(/\\/g, '/')).sort()
  const sourceBytes = [...graph].reduce((sum, file) => sum + fs.statSync(file).size, 0)
  check(graph.size <= 24, `Initial static source graph regrew: ${graph.size} modules`)
  check(sourceBytes <= 650_000, `Initial static source graph regrew: ${sourceBytes} bytes`)
  for (const name of lazySections) {
    check(!graphRelative.includes(`src/features/sections/${name}.tsx`), `Lazy section is still initial-static: ${name}`)
  }
  check(!graphRelative.includes('src/features/renderers/FinanceDashboardRenderer.tsx'), 'Finance dashboard renderer remains initial-static')
  check(!graphRelative.includes('src/features/renderers/FinanceReportContentRenderer.tsx'), 'Finance report renderer remains initial-static')

  const heavyPackages = ['docx', 'html2canvas', 'jspdf']
  for (const relative of graphRelative.filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'))) {
    const text = read(relative)
    const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, relative.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      check(!heavyPackages.includes(statement.moduleSpecifier.text), `${relative}: heavy export package ${statement.moduleSpecifier.text} became a static import`)
    }
  }
  check(app.includes("await import('docx')"), 'docx is no longer on-demand')
  check(app.includes("import('html2canvas')"), 'html2canvas is no longer on-demand')
  check(app.includes("import('jspdf')"), 'jspdf is no longer on-demand')

  check(main.includes("window.addEventListener('vite:preloadError'"), 'Dynamic import version-skew fallback missing')
  check(main.includes('window.location.reload()'), 'Dynamic import fallback no longer reloads stale deployment')
  check(main.includes('15_000'), 'Dynamic import reload loop guard missing')

  check(worker.includes("bundleLazyLoading: '1906d'"), '1906D live health marker missing')
  console.log(`STEP 190.6D BUNDLE / LAZY-LOADING TESTS PASSED — ${graph.size} initial-static source modules, ${sourceBytes} source bytes, ${lazySections.length} lazy feature boundaries`)
} catch (error) {
  console.error(`STEP 190.6D BUNDLE / LAZY-LOADING TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
