import assert from 'node:assert/strict'
import {warehouseOperationFeedback} from '../worker/domains/warehouse-operation-feedback.ts'
for(const [kind,msg] of [
 ['arrival','Приход «SKU»: пол, цвет, материал, длина, размер или тип не совпадают с выбранным вариантом. Выберите комбинацию заново. Склад не изменён.'],
 ['manual_set','Корректировка: характеристики не соответствуют выбранному варианту. Выберите существующую комбинацию заново.'],
 ['transfer','Перемещение: выбранная вещь больше не соответствует характеристикам варианта из каталога. Обновите остатки и выберите товар заново. Склад не изменён.']
]){
 const result=warehouseOperationFeedback(new Error(msg),kind,'test-mismatched-sku')
 assert.equal(result.status,409,kind+' must report stale SKU as safe client conflict')
 assert.equal(result.code,'warehouse_sku_mismatch')
 assert.match(result.message,/(?:не соответству|не совпадают)/)
}
const sql=warehouseOperationFeedback(new Error('SQLITE_IOERR: disk failure'),'arrival','db-failure')
assert.equal(sql.status,500,'A real database write failure must not be masked as input conflict')
assert.equal(sql.code,'warehouse_write_failed')
console.log('MAIN_WAREHOUSE_SKU_FEEDBACK_PASS: wrong canonical SKU=409, genuine persistence failure=500')
