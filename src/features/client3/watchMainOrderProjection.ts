import {projectOrderOperationalState} from '../../app/orderOperationalProjection'
import {projectOrderShipmentDisplay} from '../../app/orderShipmentProjection'
import type {OrderRecord} from '../../app/types'

/**
 * Client3 watch orders reuse Main's authoritative read-only UI projections.
 * Never derive a "returned order" or "exchanged order" terminal status.
 * Returns, exchanges, money, logistics and per-item shipment are separate facts.
 */
export type WatchMainItem = {
  id:number;quantity:number;source:string;stockWriteoffStatus:string;
  shipped:number;returnableQuantity:number;returnedQuantity?:number
}
export type WatchMainOrder = {
  orderStatus:string;shippingStatus:string;totalAmount:number;receivedAmount:number;
  returnAmount:number;debtAmount:number;committedReturnCount?:number;
  committedExchangeCount?:number;committedItemReturnQuantity?:number;
  itemLines:string
}
export const parseWatchMainLines=(raw:string):WatchMainItem[]=>{
  try{
    const result=JSON.parse(raw||'[]') as unknown
    return Array.isArray(result)?result.filter((x):x is WatchMainItem=>
      typeof x==='object'&&x!==null&&Number.isSafeInteger(Number(x.id))&&
      Number(x.quantity)>0):[]
  }catch{return []}
}

export function projectWatchOrderLikeMain(order:WatchMainOrder,isAdmin=false){
  const items=parseWatchMainLines(order.itemLines).map(item=>{
    const quantity=Math.max(1,Math.trunc(Number(item.quantity||1)))
    const stock=String(item.stockWriteoffStatus||'')
    const shipped=Boolean(Number(item.shipped))||
      ['fulfilled','written_off','negative','retired_physically_issued'].includes(stock)
    return {
      id:item.id,
      quantity,
      sourceType:item.source==='boutique'?'boutique':'warehouse',
      isWorkshop:false,
      stockWriteoffStatus:stock,
      shipmentSentQuantity:shipped?quantity:0,
    }
  })
  const main={
    order_status:order.orderStatus,
    shipping_status:order.shippingStatus,
    total_amount:order.totalAmount,
    received_amount:order.receivedAmount,
    debt_amount:order.debtAmount,
    return_amount:order.returnAmount,
    committed_return_count:Number(order.committedReturnCount||0),
    committed_exchange_count:Number(order.committedExchangeCount||0),
    has_committed_item_return:Number(order.committedItemReturnQuantity||0)>0,
    items,
  } as unknown as OrderRecord
  const operational=projectOrderOperationalState(main,{isAdmin})
  const shipment=projectOrderShipmentDisplay(main)
  return {operational,shipment}
}
