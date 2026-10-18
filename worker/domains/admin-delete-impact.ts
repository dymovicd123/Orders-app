// Read-only itemized accounting impact for the administrator's deletion review.
// We do not infer a physical stock increase from the release of a reservation.
import { cleanText, toInt } from '../core/text.ts'

export type ExchangeDeleteLine = {
  id:number;orderItemId:number;name:string;quantity:number;
  gender:string;color:string;material:string;length:string;size:string;
  source:string;
}
export type AdminDeleteImpact = {
  saleAmount:number; debtAmount:number; paymentReversal:number; refundReversal:number;
  netMoneyReversal:number;
  payments:Array<{id:number;date:string;method:string;amount:number;kind:string}>;
  refunds:Array<{id:number;date:string;method:string;amount:number}>;
  exchanges:Array<{
    id:number;date:string;comment:string;financialAction:string;
    financialAmount:number;paymentMethod:string;oldItems:ExchangeDeleteLine[];
    newItems:ExchangeDeleteLine[];missingHistory:boolean
  }>;
  reservations:Array<{orderItemId:number;name:string;source:string;quantity:number;status:string;
    action:'release_reserve'|'requires_physical_review'|'unchanged'}>;
  truncated:boolean;
}
export async function previewAdminDeleteImpact(db:D1Database,orderId:number,
  saleAmount:number,activeReturns:ReadonlySet<number>):Promise<AdminDeleteImpact>{
  const [pay,item,returns,exchangeQuery,stock]=await Promise.all([
    db.prepare('SELECT * FROM payments WHERE order_id=? ORDER BY id LIMIT 501').bind(orderId).all<Record<string,unknown>>(),
    db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id LIMIT 501').bind(orderId).all<Record<string,unknown>>(),
    db.prepare('SELECT * FROM returns WHERE order_id=? ORDER BY id LIMIT 501').bind(orderId).all<Record<string,unknown>>(),
    db.prepare('SELECT * FROM exchanges WHERE order_id=? ORDER BY id LIMIT 501').bind(orderId).all<Record<string,unknown>>(),
    db.prepare('SELECT * FROM inventory_reservations WHERE order_id=? ORDER BY id LIMIT 501').bind(orderId).all<Record<string,unknown>>(),
  ])
  const paymentRows=pay.results||[],itemRows=item.results||[],returnRows=returns.results||[],
    exchangeRows=exchangeQuery.results||[],reservationRows=stock.results||[]
  const byItem=new Map(itemRows.map(row=>[toInt(row.id,0),row]))
  const payments=paymentRows.map(row=>({
    id:toInt(row.id,0),date:cleanText(row.payment_date),method:cleanText(row.method)||'Не указан',
    amount:Math.max(0,toInt(row.amount,0)),kind:cleanText(row.payment_kind)||'primary',
  }))
  const refunds=returnRows.filter(row=>activeReturns.has(toInt(row.id,0))).map(row=>({
    id:toInt(row.id,0),date:cleanText(row.return_date),
    method:cleanText(row.refund_method)||cleanText(row.method)||'Не указан',
    amount:Math.max(0,toInt(row.amount,0)),
  }))
  const activeExchangeRows=exchangeRows.filter(row=>cleanText(row.status)!=='cancelled')
  // The historical exchange_items snapshots, rather than today's order_items,
  // describe what was actually replaced. One exchange may contain many lines.
  // Never substitute a later order-item price/name for the original snapshot.
  const exchangeIds=activeExchangeRows.map(row=>toInt(row.id,0)).filter(Boolean)
  const exchangeItems=exchangeIds.length
    ?await db.prepare(`SELECT *
        FROM exchange_items
        WHERE exchange_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
        ORDER BY exchange_id,id LIMIT 501`).bind(JSON.stringify(exchangeIds)).all<Record<string,unknown>>()
    :{results:[] as Record<string,unknown>[]}
  const byExchange=new Map<number,{oldItems:ExchangeDeleteLine[];newItems:ExchangeDeleteLine[]}>()
  for(const row of exchangeItems.results||[]){
    const exchangeId=toInt(row.exchange_id,0),role=cleanText(row.role)
    if(!exchangeIds.includes(exchangeId)||!['old','new'].includes(role))continue
    const group=byExchange.get(exchangeId)||{oldItems:[],newItems:[]}
    const line:ExchangeDeleteLine={
      id:toInt(row.id,0),orderItemId:toInt(row.order_item_id,0),
      name:cleanText(row.product_name_snapshot)||'Товар без названия',
      quantity:Math.max(0,toInt(row.quantity,0)),
      gender:cleanText(row.gender_snapshot),color:cleanText(row.color_snapshot),
      material:cleanText(row.material_snapshot),length:cleanText(row.length_snapshot),
      size:cleanText(row.size_snapshot),source:cleanText(row.inventory_source),
    }
    if(role==='old')group.oldItems.push(line)
    else group.newItems.push(line)
    byExchange.set(exchangeId,group)
  }
  const exchanges=activeExchangeRows.map(row=>{
    const id=toInt(row.id,0)
    const group=byExchange.get(id)||{oldItems:[],newItems:[]}
    return {
      id,date:cleanText(row.exchange_date),comment:cleanText(row.comment),
      financialAction:cleanText(row.financial_action)||'none',
      financialAmount:Math.max(0,toInt(row.financial_amount,0)),
      paymentMethod:cleanText(row.payment_method),
      oldItems:group.oldItems,newItems:group.newItems,
      missingHistory:!group.oldItems.length||!group.newItems.length,
    }
  })
  const reservations=reservationRows.map(row=>{
    const orderItemId=toInt(row.order_item_id,0),i=byItem.get(orderItemId)
    const status=cleanText(row.status),source=cleanText(row.inventory_source)||'warehouse'
    const quantity=Math.max(0,toInt(row.quantity,0))
    return {orderItemId,
      name:cleanText(i?.product_name_snapshot)||'Позиция #'+String(orderItemId),
      source,quantity,status,
      action:status==='active'?'release_reserve' as const
        :status==='fulfilled'?'requires_physical_review' as const:'unchanged' as const,
    }
  })
  const paymentReversal=payments.reduce((n,p)=>n+p.amount,0)
  const refundReversal=refunds.reduce((n,p)=>n+p.amount,0)
  return {
    saleAmount,debtAmount:Math.max(0,saleAmount-paymentReversal),
    paymentReversal,refundReversal,netMoneyReversal:refundReversal-paymentReversal,
    payments,refunds,exchanges,reservations,
    truncated:[paymentRows,itemRows,returnRows,exchangeRows,reservationRows,
      exchangeItems.results||[]].some(x=>x.length>500),
  }
}
