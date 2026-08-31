from pathlib import Path

p=Path('worker/domains/order-reservations.ts')
text=p.read_text()
replacements = [
  ("""    if (effectiveQuantity < requirement.required) {
      throw new Error(`Нельзя отправить заказ целиком: «${requirement.productName}» — на месте ${effectiveQuantity} шт., для этого заказа требуется ${requirement.required}.`);
    }
""", """    // A physical shortage is an inventory discrepancy, not a reason to block customer handover.
    // Shipping consumes only the stock that is actually present and never drives physical quantity below zero.
"""),
  ("const quantityAfter = quantityBefore - quantity;", "const quantityAfter = Math.max(0, quantityBefore - quantity);"),
  ("SET quantity = (SELECT x.effective_quantity - x.required FROM x WHERE x.stock_id = inventory_stock.id),", "SET quantity = MAX(0, (SELECT x.effective_quantity - x.required FROM x WHERE x.stock_id = inventory_stock.id)),"),
  ("x.color, x.material, x.length, x.size, -x.quantity, x.quantity_after,", "x.color, x.material, x.length, x.size, x.quantity_after - x.quantity_before, x.quantity_after,"),
  ("return [...(unresolvedResult.results || []), ...(shortageResult.results || [])];", "// Physical shortages stay visible in stock truth, but no longer hard-block shipping.\n  return [...(unresolvedResult.results || [])];"),
]
for old,new in replacements:
    count=text.count(old)
    if count != 1:
        raise SystemExit(f'Expected exactly one source anchor, found {count}: {old[:100]!r}')
    text=text.replace(old,new,1)
p.write_text(text)

pkg=Path('package.json')
text=pkg.read_text()
old='node scripts/test-arrival-materialization-reliability.mjs && node scripts/test-stocktake-functional-acceptance.mjs'
new='node scripts/test-arrival-materialization-reliability.mjs && node scripts/test-shipping-shortage-nonblocking.mjs && node scripts/test-stocktake-functional-acceptance.mjs'
if text.count(old) != 1: raise SystemExit('release:check anchor missing')
pkg.write_text(text.replace(old,new,1))

Path('scripts/test-shipping-shortage-nonblocking.mjs').write_text("""import fs from 'node:fs'\nimport path from 'node:path'\nconst root=process.cwd()\nconst source=fs.readFileSync(path.join(root,'worker/domains/order-reservations.ts'),'utf8')\nconst check=(value,message)=>{ if(!value) throw new Error(message) }\nconst fulfillStart=source.indexOf('export async function fulfillOrderReservationsV2')\nconst blockerStart=source.indexOf('export async function getOrderShipmentInventoryBlockers')\ncheck(fulfillStart>=0 && blockerStart>fulfillStart,'shipment functions missing')\nconst fulfill=source.slice(fulfillStart, blockerStart)\nconst blockers=source.slice(blockerStart)\ncheck(!fulfill.includes('effectiveQuantity < requirement.required'), 'physical shortage still hard-blocks fulfillment')\ncheck(fulfill.includes('Math.max(0, quantityBefore - quantity)'), 'per-reservation physical clamp missing')\ncheck(fulfill.includes('SET quantity = MAX(0, (SELECT x.effective_quantity - x.required'), 'aggregate physical clamp missing')\ncheck(fulfill.includes('x.quantity_after - x.quantity_before, x.quantity_after'), 'sale movement must record actual physical delta')\ncheck(blockers.includes('return [...(unresolvedResult.results || [])];'), 'shipment blocker list still includes physical shortage')\ncheck(!blockers.includes('return [...(unresolvedResult.results || []), ...(shortageResult.results || [])];'), 'old shortage blocker return remains')\nconsole.log('SHIPPING SHORTAGE NON-BLOCKING TESTS PASSED — physical discrepancy no longer blocks send; stock never drops below zero')\n""")

gate=Path('scripts/test-step1906a-worker-modularization.mjs')
text=gate.read_text()
old="const arrivalSaveReliabilityPath = path.join(root, 'scripts/arrival-save-reliability-worker-manifest.json')"
new=old+"\nconst shippingShortageHotfixPath = path.join(root, 'scripts/shipping-shortage-hotfix-worker-manifest.json')"
if text.count(old) != 1: raise SystemExit('1906A path anchor missing')
text=text.replace(old,new,1)
old="""  const arrivalSaveReliabilityChanges = arrivalSaveReliability.changes || {}
  const stocktakeLostResponse = fs.existsSync(stocktakeLostResponsePath) ? JSON.parse(fs.readFileSync(stocktakeLostResponsePath, 'utf8')) : null
"""
new="""  const arrivalSaveReliabilityChanges = arrivalSaveReliability.changes || {}
  check(fs.existsSync(shippingShortageHotfixPath), 'Shipping shortage hotfix Worker manifest missing')
  const shippingShortageHotfix = JSON.parse(fs.readFileSync(shippingShortageHotfixPath, 'utf8'))
  check(shippingShortageHotfix?.version === 1 && shippingShortageHotfix?.revision === 'shipping-shortage-nonblocking-r1', 'Shipping shortage hotfix Worker manifest invalid')
  const shippingShortageHotfixChanges = shippingShortageHotfix.changes || {}
  const stocktakeLostResponse = fs.existsSync(stocktakeLostResponsePath) ? JSON.parse(fs.readFileSync(stocktakeLostResponsePath, 'utf8')) : null
"""
if text.count(old) != 1: raise SystemExit('1906A load anchor missing')
text=text.replace(old,new,1)
old="""    const arrivalSaveReliabilityChanged = arrivalSaveReliabilityChanges[name]
    if (arrivalSaveReliabilityChanged) {
      check(arrivalSaveReliabilityChanged.before === acceptedPostPhase1bHash, `Arrival save reliability baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === arrivalSaveReliabilityChanged.after, `Worker declaration changed beyond exact Arrival save reliability allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostPhase1bHash, `Worker declaration body changed beyond accepted Finance F1-F9 / Phase 1B / Arrival reliability deltas: ${name}`)
    }
"""
new="""    const arrivalSaveReliabilityChanged = arrivalSaveReliabilityChanges[name]
    let acceptedPostArrivalReliabilityHash = acceptedPostPhase1bHash
    if (arrivalSaveReliabilityChanged) {
      check(arrivalSaveReliabilityChanged.before === acceptedPostPhase1bHash, `Arrival save reliability baseline hash mismatch: ${name}`)
      acceptedPostArrivalReliabilityHash = arrivalSaveReliabilityChanged.after
    }
    const shippingShortageHotfixChanged = shippingShortageHotfixChanges[name]
    if (shippingShortageHotfixChanged) {
      check(shippingShortageHotfixChanged.before === acceptedPostArrivalReliabilityHash, `Shipping shortage hotfix baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === shippingShortageHotfixChanged.after, `Worker declaration changed beyond exact Shipping shortage hotfix allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostArrivalReliabilityHash, `Worker declaration body changed beyond accepted Finance F1-F9 / Phase 1B / Arrival reliability / Shipping shortage deltas: ${name}`)
    }
"""
if text.count(old) != 1: raise SystemExit('1906A chain anchor missing')
gate.write_text(text.replace(old,new,1))
