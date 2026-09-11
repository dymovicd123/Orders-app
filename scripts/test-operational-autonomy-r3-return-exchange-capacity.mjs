import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync('worker/domains/returns-exchanges.ts', 'utf8');

// R3 deliberately replaces order-wide return/exchange locks with remaining capacity per order item.
assert.ok(!source.includes('По этому заказу уже оформлен возврат. Сначала отмените его'), 'global second-return lock must stay removed');
assert.ok(!source.includes('По заказу уже оформлен обычный возврат. Сначала отмените возврат'), 'global return/exchange lock must stay removed');
assert.ok(source.includes('ri.order_item_id = ?'), 'return/exchange capacity must be scoped to the concrete order item');
assert.ok(source.includes("AND COALESCE(r.status, 'completed') <> 'cancelled'"), 'cancelled returns must not consume capacity');
assert.ok(source.includes('AND ${noStandaloneReturnSql}'), 'exchange-linked refund rows must not be counted again as standalone returns');
assert.ok(source.includes('selected.orderItemId, operationReturnId, operationReturnId'), 'return retry must exclude its own return from consumed quantity');
assert.ok(source.includes('toInt(orderItem.quantity, 0) - alreadyReturnedQuantity'), 'new return must use remaining item quantity');
assert.ok(source.includes('rawOldQuantity - activeStandaloneReturnedQuantity'), 'exchange must respect prior standalone returns');
assert.ok(source.includes('const remainingOldQuantity = Math.max(0, rawOldQuantity - oldQuantity);'), 'exchange must not double-subtract prior returns from order_items.quantity');
assert.ok(source.includes('currentTaskQuantity + returnedTaskQuantity'), 'cancelling one workshop return must add back only that return instead of erasing later operations');

console.log('Operational Autonomy R3 return/exchange capacity checks passed.');
