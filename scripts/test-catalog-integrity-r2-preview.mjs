import assert from 'node:assert/strict'
import fs from 'node:fs'
import { groupEquivalentReferenceValues } from '../worker/domains/reference-integrity.ts'

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
assert.equal(groups.length,2)
assert.equal(groups[0].kind,'city')
assert.equal(groups[0].items[0].id,6)
assert.equal(groups[1].kind,'color')
assert.deepEqual(groups[1].items.map(x=>x.id),[1,2])
assert.ok(!groups.some(g=>g.kind==='material'),'Different materials must not merge')
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
assert.doesNotMatch(preview,/UPDATE\s+|DELETE\s+FROM\s+|INSERT\s+INTO\s+/i)
assert.match(panel,/Посмотреть последствия/)
assert.match(page,/<ReferenceIntegrityPanel apiFetch=\{apiFetch\} isAdmin=\{isAdmin\}/)
assert.match(app,/<ReferencesSection ctx=\{\{ apiFetch,/)
console.log('CATALOG INTEGRITY R2 PREVIEW PASSED — group identity, admin gate, read-only facts, visible impact and untouched stock')
