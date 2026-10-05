import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (value, message) => { if (!value) throw new Error(message) }

const domain = read('worker/domains/returns-exchanges.ts')
const reservations = read('worker/domains/order-reservations.ts')
const batch = read('worker/domains/exchange-batch.ts')
const router = read('worker/index.ts')
const types = read('src/app/types.ts')
const utils = read('src/app/utils.ts')
const app = read('src/App.tsx')
const ui = read('src/features/sections/OrderExchangeSection.tsx')

check(domain.includes("oldPhysicalState?: 'not_issued' | 'pending' | 'warehouse' | 'boutique' | 'no_stock'"), 'Worker single-exchange contract lacks not_issued')
check(batch.includes("oldPhysicalState?: 'not_issued' | 'pending' | 'warehouse' | 'boutique' | 'no_stock'"), 'Batch exchange contract lacks not_issued')
check(router.includes("oldPhysicalState?: 'not_issued' | 'pending' | 'warehouse' | 'boutique' | 'no_stock'"), 'API boundary lacks not_issued')
check(types.includes("oldPhysicalState: 'not_issued' | 'pending' | 'warehouse' | 'boutique' | 'no_stock'"), 'Frontend exchange draft lacks not_issued')
check(app.includes("oldPhysicalState: 'not_issued' | 'pending' | 'warehouse' | 'boutique' | 'no_stock'"), 'Exchange save pair typing drops not_issued')

check(domain.includes("const oldWasNotIssued = oldPhysicalState === 'not_issued'"), 'Domain does not branch explicit not-issued truth')
check(domain.includes("!oldWasNotIssued\n    && !oldWasAlreadyIssued"), 'Not-issued flow can still enter fake handover reconciliation')
check(domain.includes("await releaseOrderReservationV2("), 'Not-issued exchange does not release reservation')
check(domain.includes("oldWasNotIssued ? 'not_issued'"), 'Not-issued audit marker is not persisted on exchange old snapshot')
check(domain.includes("oldWasNotIssued: cleanText(row.old_inventory_source) === 'not_issued'"), 'Exchange history does not expose not-issued audit marker')
check(domain.includes("marker.inventory_source = 'not_issued'"), 'Exchange cancellation cannot recognize not-issued history')
check(domain.includes("await reactivateReleasedOrderReservationV2("), 'Exchange cancellation does not restore released old reservation')

const helperStart = reservations.indexOf('export async function reactivateReleasedOrderReservationV2(')
const helperEnd = reservations.indexOf('export async function releaseOrderReservationsV2(', helperStart)
check(helperStart >= 0 && helperEnd > helperStart, 'Released-reservation reactivation helper missing')
const helper = reservations.slice(helperStart, helperEnd)
check(helper.includes("status !== 'released'"), 'Reservation reactivation is not fail-closed on released state')
check(helper.includes("SET reserved_quantity = MAX(0, COALESCE(reserved_quantity, 0) + ?)"), 'Reservation reactivation does not restore reserved quantity')
check(!helper.includes('SET quantity ='), 'Reservation reactivation must not change physical stock quantity')
check(helper.includes("SET status = 'active'") && helper.includes("SET status = 'unresolved'"), 'Reservation reactivation does not preserve resolved/unresolved semantics')

check(ui.includes('Не выдавали клиенту — остаётся на месте'), 'Human not-issued choice missing in exchange form')
check(ui.includes('Никакого фиктивного списания и обратного прихода не будет'), 'UI does not explain that physical stock stays unchanged')
check(ui.includes('Клиент ещё не вернул'), 'Issued-but-pending return choice is not distinct from never-issued choice')
check(utils.includes("order?.shipping_status === 'sent'") && utils.includes(": 'not_issued'"), 'Unsent exchange does not default to not-issued state')
check(domain.includes('Эта позиция уже отмечена как выданная клиенту'), 'Backend does not reject a contradictory not-issued claim')

check(ui.includes("financialAction === 'none' ? { financialAmount: 0, paymentMethod: '' }"), 'Switching to no-money exchange keeps stale amount/method')
check(ui.includes('Денежного движения по обмену не будет'), 'No-money exchange UI remains ambiguous')

console.log('EXCHANGE NOT-ISSUED R1 PASSED — never-issued old goods release only their reservation, keep physical stock untouched, remain auditable, and are safely restorable on exchange cancellation')
