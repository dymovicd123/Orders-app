import fs from 'node:fs'

let failed = false
const check = (condition, message) => { if (!condition) { failed = true; console.error('FAIL:', message) } else console.log('OK:', message) }
const read = fs.readFileSync('worker/domains/inventory-read.ts','utf8')
const movement = fs.readFileSync('worker/domains/inventory-movement.ts','utf8')
check(read.includes('OR COALESCE(s.quantity, 0) <> 0') && read.includes('OR COALESCE(s.reserved_quantity, 0) <> 0'), 'live stock on archived catalog identities stays visible')
check(read.includes('catalogArchived:'), 'inventory response marks archived catalog identity')
check(movement.includes('SELECT id, name, category, external_id, is_active, gender_scope FROM catalog_products'), 'bulk inventory resolver reuses existing product read for gender scope')
check(movement.includes("if (scope === 'female') return 'ЖЕН'") && movement.includes("if (scope === 'male') return 'МУЖ'"), 'fixed product scope auto-fills inventory gender')
check(movement.includes('Для товара «Унисекс» выберите пол конкретной вещи'), 'unisex blank inventory gender requires human choice')
check(movement.includes("if (explicit === 'ЖЕН' || explicit === 'МУЖ') return explicit"), 'explicit human gender remains authoritative')
if (failed) process.exit(1)
console.log('Catalog integrity dead ends R1: OK')
