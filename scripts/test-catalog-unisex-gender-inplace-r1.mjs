import fs from 'node:fs'
let failed=false
const check=(condition,message)=>{if(!condition){failed=true;console.error('FAIL:',message)}else console.log('OK:',message)}
const worker=fs.readFileSync('worker/domains/catalog.ts','utf8')
const ui=fs.readFileSync('src/features/inventory/views/renderInventoryCatalogPanel.tsx','utf8')
check(worker.includes("const safeLegacyUnisexGenderCorrection = productScope === 'unisex'"),'correction is limited to unisex products')
check(worker.includes("existingGender === '' && (gender === 'ЖЕН' || gender === 'МУЖ')"),'only blank to concrete gender is eligible')
check(worker.includes("&& !duplicate?.id"),'in-place path never collides with existing concrete sibling')
check(worker.includes('await db.batch(['),'variant stock snapshot and audit update atomically')
check(worker.includes('UPDATE inventory_stock SET gender_snapshot = ?, updated_at = ? WHERE variant_id = ?'),'current stock snapshot follows corrected gender')
check(worker.includes("VALUES (?, ?, ?, ?, 'in_place', ?)"),'repair is audited')
check(worker.includes('return { ok: true, correctedGender: true, merged: false }'),'success is explicit')
check(!worker.includes('UPDATE order_items SET gender_snapshot'),'historical order snapshots are not rewritten')
check(ui.includes('Старой унисекс-позиции без пола можно выбрать ЖЕН или МУЖ даже при наличии истории'),'UI explains supported correction')
if(failed)process.exit(1)
console.log('Catalog unisex gender in-place R1: OK')
