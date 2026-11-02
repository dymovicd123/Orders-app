import assert from 'node:assert/strict'
import {
  WATCH_BRANDS, WATCH_DIAL_COLORS, WATCH_PAYMENT_METHODS, WATCH_SOURCES,
  identifyWatchVariant, toCanonicalWatchStockSource, toVisibleWatchSource,
  validateWatchDelivery, validateWatchDeadline, normalizeWatchOrderLine,
} from '../../client3/watch/contract.ts'

const base={
  brand:'TAUWACH',
  modelName:'Model 21',
  gender:'male',
  mechanism:'quartz',
  braceletMaterial:'leather',
  dialColor:'black',
  braceletColor:'чёрный',
}
const sku=identifyWatchVariant(base)
assert.equal(sku.modelName,'Model 21')
assert.equal(sku.brand,'TAUWACH')
assert.equal(sku.braceletColor,'чёрный')
assert.equal(identifyWatchVariant({...base,modelName:'  model  21  ',braceletColor:'ЧЁРНЫЙ'}).skuKey,sku.skuKey,
  'Safe spelling differences resolve to same exact canonical watch SKU')

for(const [attr,other] of [
  ['brand','WACHIZEN'],['gender','female'],['mechanism','mechanical'],
  ['braceletMaterial','steel'],['dialColor','silver'],['braceletColor','коричневый'],
]) {
  const next={...base,[attr]:other}
  if(attr==='braceletMaterial')next.braceletColor=null
  const candidate=identifyWatchVariant(next)
  assert.notEqual(candidate.skuKey,sku.skuKey,'Watch SKU identity must include '+attr)
}
assert.notEqual(identifyWatchVariant({...base,modelName:'Model 22'}).skuKey,sku.skuKey)
assert.notEqual(identifyWatchVariant({...base,braceletColor:'коричневый'}).skuKey,sku.skuKey,
  'Same watch/leather strap in black versus brown is separate inventory stock')
assert.notEqual(identifyWatchVariant({...base,braceletMaterial:'rubber',braceletColor:null}).skuKey,sku.skuKey)
assert.equal(identifyWatchVariant({...base,braceletMaterial:'steel',braceletColor:null}).braceletColor,null)
assert.throws(()=>identifyWatchVariant({...base,braceletColor:''}),/кожаного ремешка/)
assert.throws(()=>identifyWatchVariant({...base,braceletMaterial:'steel',braceletColor:'black'}),/только для кожаного/)
assert.throws(()=>identifyWatchVariant({...base,gender:'unisex'}),/Пол/)
assert.throws(()=>identifyWatchVariant({...base,dialColor:'pink'}),/циферблата/)
assert.throws(()=>identifyWatchVariant({...base,brand:'THIRD-BRAND'}),/Бренд/)
assert.throws(()=>identifyWatchVariant({...base,modelName:''}),/название модели/)
assert.deepEqual(WATCH_BRANDS,['TAUWACH','WACHIZEN'])
assert.equal(WATCH_DIAL_COLORS.length,8)
assert.deepEqual(WATCH_PAYMENT_METHODS,['KASPI RED','KASPI GOLD','Рассрочка'])
assert.deepEqual(WATCH_SOURCES,['office','showcase'])
assert.equal(toCanonicalWatchStockSource('office'),'warehouse')
assert.equal(toCanonicalWatchStockSource('showcase'),'boutique')
assert.equal(toVisibleWatchSource('warehouse'),'Офис')
assert.equal(toVisibleWatchSource('boutique'),'Витрина')
assert.throws(()=>toCanonicalWatchStockSource('workshop'),/Офис и Витрина/)

const delivery={
  recipientFullName:'  Алия  Тестова ',recipientPhone:'+7 700 000 00 00',
  fullAddress:'Алматы, ул. Примерная, 10',postalIndex:'050000',city:'Алматы',deliveryType:'ПОЧТА',
}
assert.equal(validateWatchDelivery(delivery).recipientFullName,'Алия Тестова')
assert.throws(()=>validateWatchDelivery({...delivery,fullAddress:''}),/адрес/)
assert.throws(()=>validateWatchDelivery({...delivery,postalIndex:''}),/индекс/)
assert.throws(()=>validateWatchDelivery({...delivery,recipientFullName:''}),/ФИО/)
assert.equal(validateWatchDelivery({...delivery,deliveryType:'САМОВЫВОЗ',fullAddress:'',postalIndex:''}).fullAddress,
  '', 'Pickup cannot be blocked by post-only fields')

const deadline=validateWatchDeadline(true,'2026-11-15T17:00')
assert.deepEqual(deadline,{urgent:true,dueLocal:'2026-11-15T17:00',timeZone:'Asia/Almaty'})
assert.throws(()=>validateWatchDeadline(true,''),/срочного/)
assert.throws(()=>validateWatchDeadline(false,'2026-11-15'),/время/)
assert.throws(()=>validateWatchDeadline(true,'2026-02-30T17:00'),/существующую дату/)
assert.throws(()=>validateWatchDeadline(true,'2026-11-15T25:00'),/корректное время/)
assert.equal(validateWatchDeadline(false,'').dueLocal,null)

assert.deepEqual(normalizeWatchOrderLine({variant:base,quantity:2,engravingText:'  Наурыз  құтты болсын '}).engravingText,
  'Наурыз құтты болсын')
assert.throws(()=>normalizeWatchOrderLine({variant:base,quantity:0,engravingText:''}),/Количество/)
assert.throws(()=>normalizeWatchOrderLine({variant:base,quantity:1.5,engravingText:''}),/Количество/)
assert.throws(()=>normalizeWatchOrderLine({variant:base,quantity:1,engravingText:'a'.repeat(1001)}),/слишком длинный/)

console.log('CLIENT3_WATCH_CONTRACT_PASS: brand/SKU dual colors + source aliases + KazPost fields + urgent hours + payment methods; no Worker/D1 writes')
