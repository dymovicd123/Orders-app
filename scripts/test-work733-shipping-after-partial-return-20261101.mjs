// Work #733: a partial Return must not permanently lock unrelated ready items.
import assert from 'node:assert/strict'
import {projectOrderOperationalState} from '../src/app/orderOperationalProjection.ts'

const base={
 order_status:'active',shipping_status:'not_sent',
 committed_return_count:1,committed_exchange_count:0,
 has_committed_item_return:true,received_amount:3000,return_amount:1000,debt_amount:0,
 workshop_status:'in_workshop',
}
const stock={id:5208,quantity:1,sourceType:'warehouse',isWorkshop:false,
 stockWriteoffStatus:'fulfilled',productName:'STAGE4 WAREHOUSE'}
const readyWorkshop={id:5209,quantity:1,sourceType:'workshop',isWorkshop:true,
 workshopTaskStatus:'done',productName:'STAGE4 WORKSHOP'}
const runningWorkshop={...readyWorkshop,workshopTaskStatus:'active'}
const afterReturn={...base,items:[stock,readyWorkshop]}
const p=projectOrderOperationalState(afterReturn,{isAdmin:false})
assert.equal(p.hasCommittedItemReturn,true)
assert.equal(p.workshopPending,false,'Linked workshop task finished even if coarse cache says in_workshop')
assert.equal(p.canShip,true,'Work #733 order 2197 must allow remaining ready Workshop delivery')
assert.equal(p.canEdit,false,'A completed physical Return must still prevent wholesale item edits')
assert.equal(p.canCorrectShipping,false,'Undo of sent state remains separately guarded')

const stillWorking=projectOrderOperationalState({...base,items:[stock,runningWorkshop]})
assert.equal(stillWorking.canShip,false,'Do not ship before Workshop is ready')
const allReturned=projectOrderOperationalState({...base,items:[stock]})
assert.equal(allReturned.canShip,false,'Return-only previously issued order cannot be blindly shipped again')
const empty=projectOrderOperationalState({...base,items:[]})
assert.equal(empty.canShip,false,'Empty return-only order is not a fresh outgoing order')
const reservedSibling=projectOrderOperationalState({...base,items:[stock,{...stock,id:5210,
 stockWriteoffStatus:'reserved',quantity:1}]})
assert.equal(reservedSibling.canShip,true,
 'Unrelated still-reserved position can be sent; server validates active Return/SKU conflicts')
const alreadySent=projectOrderOperationalState({...afterReturn,shipping_status:'sent'})
assert.equal(alreadySent.canShip,false)
const normal=projectOrderOperationalState({...base,has_committed_item_return:false,
 committed_return_count:1,items:[stock]})
assert.equal(normal.canShip,true,'Refund-only event must not block ordinary shipping')
console.log('WORK733_P1_MIXED_ORDER_SHIPPING_PROJECTION_PASS')
