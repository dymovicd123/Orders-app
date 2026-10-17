// Read-only itemized accounting impact for the administrator's deletion review.
// We do not infer a physical stock increase from the release of a reservation.
import { cleanText, toInt } from '../core/text.ts'

export type AdminDeleteImpact = {
  saleAmount:number; debtAmount:number; paymentReversal:number; refundReversal:number;
  netMoneyReversal:number;
  payments:Array<{id:number;date:string;method:string;amount:number;kind:string}>;
  refunds:Array<{id:number;date:string;method:string;amount:number}>;
  exchanges:Array<{id:number;financialAction:string;financialAmount:number}>;
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
  const exchanges=exchangeRows.filter(row=>cleanText(row.status)!=='cancelled').map(row=>({
    id:toInt(row.id,0),financialAction:cleanText(row.financial_action)||'none',
    financialAmount:Math.max(0,toInt(row.financial_amount,0)),
  }))
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
    truncated:[paymentRows,itemRows,returnRows,exchangeRows,reservationRows].some(x=>x.length>500),
  }
}
