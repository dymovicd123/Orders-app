/** Shared presentation of physical watch-item state.
 * The backend already provides exact dispatch and intake counts per item.
 * Never infer that a whole line is sent from a nonzero shipment quantity.
 */
export type WatchPhysicalItem={
  quantity:number|null
  shippedQuantity?:number|null
  returnedQuantity?:number|null
  pendingReturnQuantity?:number|null
  stockWriteoffStatus?:string|null
}

const count=(value:unknown)=>Math.max(0,Number(value)||0)

export function watchIssuedQuantity(item:WatchPhysicalItem):number{
  const quantity=count(item.quantity)
  if(item.stockWriteoffStatus==='fulfilled')return quantity
  return Math.min(quantity,count(item.shippedQuantity))
}

export const watchItemFullyIssued=(item:WatchPhysicalItem)=>
  count(item.quantity)>0&&watchIssuedQuantity(item)>=count(item.quantity)

export const watchItemAwaitingDispatch=(item:WatchPhysicalItem)=>
  Math.max(0,count(item.quantity)-watchIssuedQuantity(item))

export const watchItemAwaitingReceipt=(item:WatchPhysicalItem)=>
  count(item.pendingReturnQuantity)

export const watchItemReturnSummary=(item:WatchPhysicalItem)=>{
  const returned=count(item.returnedQuantity)
  const pending=watchItemAwaitingReceipt(item)
  return [returned>0?'Возврат оформлен: '+returned+' шт.':'',
    pending>0?'Ожидается приём: '+pending+' шт.':''].filter(Boolean).join(' · ')
}
