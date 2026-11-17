import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stocktakeFoundSkuPrintReceipt } from '../src/features/inventory/stocktakeFoundSkuPrint.ts'

const section=readFileSync('src/features/sections/InventorySection.tsx','utf8')
const panel=readFileSync('src/features/inventory/views/renderInventoryStocktakePanel.tsx','utf8')
const scanner=readFileSync('src/features/inventory/views/StocktakeBarcodeScanner.tsx','utf8')
const printer=readFileSync('src/features/inventory/views/BarcodePrintWorkspace.tsx','utf8')
const css=readFileSync('src/styles/w5-checking-ux.css','utf8')
const cameraCss=readFileSync('src/features/inventory/views/stocktakeBarcodeScanner.css','utf8')
const pkg=JSON.parse(readFileSync('package.json','utf8'))
const lock=JSON.parse(readFileSync('package-lock.json','utf8'))

assert.equal(pkg.dependencies['@zxing/browser'],'0.2.1')
assert.equal(lock.packages[''].dependencies['@zxing/browser'],'0.2.1')
assert.equal(lock.packages['node_modules/@zxing/browser']?.version,'0.2.1',
  'Cross-browser camera decoder must be locally pinned in npm ci, not downloaded from CDN')

const after=section.slice(section.indexOf('  async function applyStocktake() {'),
  section.indexOf('\n  async function addStocktakeCatalogVariant'))
assert(after.includes('if (result.session)')&&after.includes('stocktakeFoundSkuPrintReceipt(result.session)')&&
  after.includes('setStocktakePrintSessionId(printable ? result.session.id : null)')&&
  after.includes('setStocktakePrintFormOpen(false)'),
  'Successful stocktake completion must open a dedicated print decision for eligible new items')
assert(after.includes('Promise.allSettled([refreshInventoryModule(true), refreshActiveStocktakes()])'))
assert(!after.includes('onStocktakePrintOpen()')&&!after.includes('printInventory'),
  'No printing or inventory mutation during completion')

assert(panel.includes("stocktakePrintOpen && stocktakeLabelCount > 0 ? (") &&
  panel.includes('className="stocktake-postcheck-choice"') &&
  panel.includes('stocktake-postcheck-main-actions') &&
  panel.includes('Распечатать этикетки') &&
  panel.includes('Завершить без печати') &&
  panel.includes('Посмотреть результаты ревизии'),
  'Visible choice must be a separate prominent step, not hidden below stocktake metrics')
assert(panel.indexOf('className="stocktake-postcheck-choice"') < panel.indexOf('className="stocktake-outcome-card"'),
  'Dedicated print-or-skip step must render before the normal detailed outcome')
assert(panel.includes('stocktakePrintFormOpen ?')&&panel.includes('stocktakeLabelPrinter')&&
  panel.includes('onStocktakePrintClose')&&panel.includes('onStocktakePrintBackToOutcome'))
assert(printer.includes('receipt={')===false || printer.includes('printMode'), 'Existing printer remains in use')
assert(section.includes('receiptKind="stocktake"')&&section.includes('onReload={reloadBarcodePrintData}'))
assert(section.includes('setStocktakePrintSessionId(null)')&&section.includes('setStocktakePrintFormOpen(false)'),
  'Skipping must clear the print prompt and leave existing confirmed stock untouched')
assert(css.includes('.stocktake-postcheck-choice')&&css.includes('@media(max-width:600px)'))

assert(scanner.includes("import('@zxing/browser')")&&scanner.includes('BrowserMultiFormatOneDReader'))
assert(scanner.includes('decodeFromConstraints(')&&scanner.includes("facingMode: { ideal: 'environment' }"))
assert(scanner.includes('videoRef')&&scanner.includes('playsInline autoPlay muted'))
assert(scanner.includes("processRef.current(found, 'camera')")&&
  scanner.includes('gateRef.current.detected(found, now)'),
  'Camera counts automatically while remaining open and rejects stationary repeated frames')
const cameraCapture=scanner.slice(scanner.indexOf('const controls = await reader.decodeFromConstraints('),
  scanner.indexOf('if (cancelled) controls.stop()'))
assert(!cameraCapture.includes("fetch(")&&!cameraCapture.includes('onScanned(')&&
  !cameraCapture.includes('onSkuFound(')&&!cameraCapture.includes("method: 'POST'"),
  'Decoding camera frames must never automatically count an item or change server state')
assert(scanner.includes('gateRef.current.missing(now)')&&scanner.includes('cameraStopRef.current?.()') &&
  scanner.includes('stream.getTracks().forEach(track => track.stop())'),
  'Stationary frames must not be double counted and hardware camera must stop on close')
assert(scanner.includes("reason === 'NotAllowedError'")&&scanner.includes('откройте систему по HTTPS')&&
  scanner.includes('Непрерывная камера'),
  'Permissions, secure context, optional camera and manual fallback must remain explicit')
assert(scanner.includes("method: 'POST'") && scanner.includes('result.duplicate') &&
  scanner.includes('requestId: attempt.requestId'),
  'Server-authoritative counting must be retry-safe and never require an extra submit')
assert(cameraCss.includes('.stocktake-camera-panel video')&&cameraCss.includes('@media(max-width:720px)'))
assert(stocktakeFoundSkuPrintReceipt(null)===null)
console.log('STOCKTAKE_CAMERA_PRINT_STEP_PASS: prominent optional print result, iOS/Android local Code128 preview, manual fallback, no automatic writes')
