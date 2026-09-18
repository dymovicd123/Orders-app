import fs from 'node:fs'

const review = fs.readFileSync('worker/domains/catalog-review.ts', 'utf8')
const reservations = fs.readFileSync('worker/domains/order-reservations.ts', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const start = review.indexOf('export async function resolveCatalogReviewRows(')
const end = review.indexOf('export async function reconcileCatalogReviewQueue(', start)
check(start >= 0 && end > start, 'resolveCatalogReviewRows block missing')
const fn = review.slice(start, end)

check(fn.includes("normalizeShippingStatus(row.shipping_status) === 'sent'"), 'Historical sent-order identity-only boundary missing')
check(fn.includes('orderItemWasPhysicallyIssued(row)') && fn.includes("existingStatus === 'fulfilled'"), 'Already-issued physical truth is not protected from re-reservation')

check(fn.includes('SELECT id, status, quantity, inventory_source, product_id, variant_id'), 'Resolver does not inspect the complete current reservation identity')
check(fn.includes('const reservationMatchesTarget = currentSource === targetSource'), 'Resolver does not compare active reservation source')
check(fn.includes('currentVariantId === variantId'), 'Resolver does not compare active reservation variant')
check(fn.includes('currentQuantity === Math.max(1, toInt(item.quantity, 1))'), 'Resolver does not compare active reservation quantity')

const releasePos = fn.indexOf("await releaseOrderReservationV2(db, id, timestamp, 'Исправлена canonical identity позиции заказа')")
const deleteReleasedPos = fn.indexOf("DELETE FROM inventory_reservations WHERE id = ? AND status = 'released'", releasePos)
const retryMarkerPos = fn.indexOf("SET stock_writeoff_status = 'catalog_unresolved'", releasePos)
const reservePos = fn.indexOf('await reserveOrderItemV2(', releasePos)
check(releasePos >= 0 && deleteReleasedPos > releasePos, 'Old active reservation is not safely released before replacement')
check(retryMarkerPos > releasePos && retryMarkerPos < reservePos, 'Resolver does not keep failed reservation migration visible for retry')
check(reservePos > deleteReleasedPos, 'Replacement reservation can be created before old reservation is removed')

check(fn.includes("existingStatus !== 'fulfilled'"), 'Legacy unresolved/released placeholders are not separated from immutable fulfilled history')
check(fn.includes("DELETE FROM inventory_reservations WHERE id = ? AND status <> 'fulfilled'"), 'Non-physical stale reservation placeholder is not cleared before exact reserve')

const committedReadPos = fn.indexOf('const committedReservation = await db.prepare(', reservePos)
const committedProofPos = fn.indexOf('const committedMatchesTarget =', committedReadPos)
const publishPos = fn.indexOf('UPDATE order_items SET product_id = ?, variant_id = ? WHERE id = ?', committedProofPos)
check(committedReadPos > reservePos && committedProofPos > committedReadPos, 'Resolver does not prove committed reservation after retry-safe reserve')
check(fn.includes("cleanText(committedReservation?.status) === 'active'"), 'Committed reservation status is not required to be active')
check(fn.includes('toInt(committedReservation?.variant_id, 0) === variantId'), 'Committed reservation exact SKU is not verified')
check(fn.includes('normalizeSourceType(committedReservation?.inventory_source) === targetSource'), 'Committed reservation source is not verified')
check(publishPos > committedProofPos, 'Current order canonical identity is published before physical reservation truth is proven')

const activeReservationStart = fn.indexOf("if (existingReservation?.id && existingStatus === 'active')")
check(activeReservationStart >= 0 && activeReservationStart < reservePos, 'Active-reservation alignment branch missing')
check(!fn.slice(activeReservationStart, reservePos).includes('UPDATE order_items SET product_id = ?, variant_id = ? WHERE id = ?'), 'Active unsent Resolver publishes canonical identity before reservation alignment')

check(reservations.includes('if (existingReservation?.id) {'), 'reserveOrderItemV2 retry-safe existing-reservation contract unexpectedly changed')
check(!fn.includes('UPDATE inventory_movements'), 'Resolver reservation repair unexpectedly rewrites immutable physical movement history')

console.log('STAGE01 RESOLVER ACTIVE RESERVATION R12 PASSED — active unsent canonical repair cannot publish a new SKU while physical reservation still points at an old SKU')
