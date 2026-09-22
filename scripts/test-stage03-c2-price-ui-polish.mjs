import fs from 'node:fs'

const css = fs.readFileSync('src/styles/w9-warehouse-catalog-cleanup.css', 'utf8')
const groups = fs.readFileSync('src/features/inventory/views/catalogPolishExecutionGroups.tsx', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const priceStart = css.indexOf('.catalog-execution-prices {')
const priceEnd = css.indexOf('/* Stage03-C1 — exact-position card', priceStart)
check(priceStart >= 0 && priceEnd > priceStart, 'Stage03-C2 price CSS block missing')
const priceCss = css.slice(priceStart, priceEnd)

check(priceCss.includes('margin: 0;') && priceCss.includes('border-radius: 0;'), 'Price editor should integrate into the execution card instead of looking like a nested form')
check(priceCss.includes('border-top: 1px solid #e9eef4;') && priceCss.includes('border-bottom: 1px solid #e9eef4;'), 'Integrated price strip separators missing')
check(priceCss.includes('background: #fbfcfe;'), 'Price strip background should stay subtle')
check(priceCss.includes('grid-template-columns: 92px minmax(150px, 1fr) minmax(150px, 1fr) auto;'), 'Desktop price row proportions drifted')
check(priceCss.includes('.catalog-execution-price-kind strong') && priceCss.includes('border-radius: 8px;'), 'Audience marker polish missing')
check(priceCss.includes('.catalog-execution-price-row input:focus') && priceCss.includes('box-shadow: 0 0 0 3px rgba(62, 111, 182, .08);'), 'Price input focus polish missing')
check(priceCss.includes('@media (max-width: 760px)') && priceCss.includes('@media (max-width: 440px)'), 'Responsive price polish missing')

check(groups.includes('<strong>Цены</strong>'), 'Existing price heading unexpectedly changed')
check(groups.includes('<span>Для этого материала и длины</span>'), 'Existing price context unexpectedly changed')
check(!groups.includes('Текущая цена') && !groups.includes('Маржа') && !groups.includes('Скидка'), 'Stage03-C2 must not add extra price copy or new business semantics')

console.log('STAGE03-C2 PRICE UI POLISH PASSED — same controls/copy, visually integrated execution price strip, responsive layout preserved')
