import assert from 'node:assert/strict'
import fs from 'node:fs'
import { groupEquivalentReferenceValues, groupEquivalentCatalogVariants } from '../worker/domains/reference-integrity.ts'

const data=[
{id:1,kind:'color',value:'СВЕТЛО СЕРЫЙ',is_active:1},
{id:2,kind:'color',value:'СВЕТЛО-СЕРЫЙ',is_active:1},
{id:3,kind:'color',value:'СЕРЫЙ',is_active:1},
{id:4,kind:'material',value:'ДРАП',is_active:1},
{id:5,kind:'material',value:'ШЕРСТЬ',is_active:1},
{id:6,kind:'city',value:'АЛМАТЫ',is_active:1},
{id:7,kind:'city',value:'АЛМАТЫ',is_active:0},
]
const groups=groupEquivalentReferenceValues(data)
assert.equal(groups.length,1,'Only duplicated active values should need attention')
assert.equal(groups[0].kind,'color')
assert.deepEqual(groups[0].items.map(x=>x.id),[1,2])
assert.ok(!groups.some(g=>g.kind==='city'),'Resolved inactive duplicate must not be flagged')
assert.ok(!groups.some(g=>g.kind==='material'),'Different materials must not merge')
const skuGroups=groupEquivalentCatalogVariants([
 {id:1,product_id:4,stock_position_id:40,category:'adult',gender:'ЖЕН',color:'СВЕТЛО СЕРЫЙ',size_label:'52',material:'ДРАП',length:'СТАНДАРТ',product_name:'ЭТНО КАРДИГАН',physical:0,reserved:0},
 {id:2,product_id:4,stock_position_id:40,category:'adult',gender:'ЖЕН',color:'СВЕТЛО-СЕРЫЙ',size_label:'52',material:'ДРАП',length:'СТАНДАРТ',product_name:'ЭТНО КАРДИГАН',physical:0,reserved:0},
 {id:3,product_id:4,stock_position_id:41,category:'adult',gender:'ЖЕН',color:'СВЕТЛО-СЕРЫЙ',size_label:'52',material:'ШЕРСТЬ',length:'СТАНДАРТ',product_name:'ЭТНО КАРДИГАН',physical:4,reserved:0},
])
assert.equal(skuGroups.length,1,'Different material executions may never be unified')
assert.deepEqual(skuGroups[0].variants.map(x=>x.id),[1,2])

const worker=fs.readFileSync('worker/index.ts','utf8')
const preview=fs.readFileSync('worker/domains/reference-integrity.ts','utf8')
const panel=fs.readFileSync('src/features/sections/ReferenceIntegrityPanel.tsx','utf8')
const page=fs.readFileSync('src/features/sections/ReferencesSection.tsx','utf8')
const app=fs.readFileSync('src/App.tsx','utf8')
assert.match(worker,/\/api\/reference-values\/duplicates/)
assert.match(worker,/\/api\/reference-values\/consolidation-preview/)
assert.match(worker,/requireAdminUser\(authUser, 'Проверка/)
assert.match(preview,/SELECT id, kind, value, is_active FROM reference_values/)
assert.match(preview,/sourceActiveVariants/)
assert.match(preview,/activeExecutions/)
assert.match(preview,/groupEquivalentCatalogVariants/)
assert.match(preview,/LEFT JOIN inventory_stock/)
assert.match(panel,/Повторяющиеся варианты товаров/)
assert.doesNotMatch(preview,/\b(?:UPDATE|DELETE FROM|INSERT INTO)\s+(?:inventory_stock|catalog_variants|orders|order_items)\b/i)
assert.match(panel,/Посмотреть последствия/)
assert.match(page,/<ReferenceIntegrityPanel apiFetch=\{apiFetch\} isAdmin=\{isAdmin\}/)
assert.match(app,/<ReferencesSection ctx=\{\{ apiFetch,/)
console.log('CATALOG INTEGRITY R2 PREVIEW PASSED — group identity, admin gate, read-only facts, visible impact and untouched stock')
