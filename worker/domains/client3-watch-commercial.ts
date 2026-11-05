/** Client3-only commercial position of standalone physical Returns.
 *
 * Main keeps the original itemized sale and all physical dispatch/receipt
 * history immutable. A standalone returned sale unit is a noncash credit
 * against the live commercial sale; only returns.amount and financial_events
 * record money actually paid back. Never treat this adjustment as cash.
 *
 * Item prices are captured in return_items.amount by the Client3 adapter.
 * Earlier Client3 watch returns wrote zero; those use the current recorded
 * order_item unit price as a legacy fallback, without moving any money.
 *
 * Every SQL expression requires orders alias "o" unless passed an explicit
 * alias. The same source is used for orders and Main-style watch reports.
 */
export const watchCommercialReturnCreditSql=(orderAlias='o')=>`COALESCE((
 SELECT SUM(CASE WHEN COALESCE(ri.amount,0)>0 THEN ri.amount
   ELSE COALESCE(ri.quantity,0)*COALESCE(oi.unit_price,0) END)
 FROM return_items ri
 JOIN returns r ON r.id=ri.return_id
 JOIN order_items oi ON oi.id=ri.order_item_id AND oi.order_id=r.order_id
 WHERE r.order_id=${orderAlias}.id
   AND COALESCE(r.status,'completed')<>'cancelled'
),0)`

export const watchReturnedUnitsForItemSql=(itemAlias='oi')=>`COALESCE((
 SELECT SUM(ri.quantity) FROM return_items ri
 JOIN returns r ON r.id=ri.return_id
 WHERE ri.order_item_id=${itemAlias}.id AND COALESCE(r.status,'completed')<>'cancelled'
),0)`

export const watchReturnedValueForItemSql=(itemAlias='oi')=>`COALESCE((
 SELECT SUM(CASE WHEN COALESCE(ri.amount,0)>0 THEN ri.amount
   ELSE COALESCE(ri.quantity,0)*COALESCE(${itemAlias}.unit_price,0) END)
 FROM return_items ri JOIN returns r ON r.id=ri.return_id
 WHERE ri.order_item_id=${itemAlias}.id AND COALESCE(r.status,'completed')<>'cancelled'
),0)`

export const watchNetSaleSql=(orderAlias='o')=>
  `MAX(0,COALESCE(${orderAlias}.total_amount,0)-${watchCommercialReturnCreditSql(orderAlias)})`

export const watchNetPaidSql=(orderAlias='o')=>
  `MAX(0,COALESCE(${orderAlias}.received_amount,0)-COALESCE(${orderAlias}.return_amount,0))`

export const watchNetDebtSql=(orderAlias='o')=>
  `MAX(0,${watchNetSaleSql(orderAlias)}-${watchNetPaidSql(orderAlias)})`

export const watchCustomerOverpaymentSql=(orderAlias='o')=>
  `MAX(0,${watchNetPaidSql(orderAlias)}-${watchNetSaleSql(orderAlias)})`

export type WatchCommercialBalance={
 grossTotal:number;returnedGoodsValue:number;netSale:number;received:number;
 refunded:number;netPaid:number;netDebt:number;overpayment:number
}
export async function readWatchCommercialBalance(db:D1Database,orderId:number):Promise<WatchCommercialBalance>{
 const result=await db.prepare(`
 SELECT COALESCE(o.total_amount,0) AS grossTotal,
   ${watchCommercialReturnCreditSql('o')} AS returnedGoodsValue,
   ${watchNetSaleSql('o')} AS netSale,
   COALESCE(o.received_amount,0) AS received,
   COALESCE(o.return_amount,0) AS refunded,
   ${watchNetPaidSql('o')} AS netPaid,
   ${watchNetDebtSql('o')} AS netDebt,
   ${watchCustomerOverpaymentSql('o')} AS overpayment
 FROM orders o JOIN watch_order_details wd ON wd.order_id=o.id
 WHERE o.id=? LIMIT 1
 `).bind(orderId).first<Record<string,number>>()
 if(!result)throw new Error('Заказ часов не найден.')
 const data=Object.fromEntries(
   Object.entries(result).map(([key,value])=>[key,Number(value||0)]),
 ) as WatchCommercialBalance
 if(!Object.values(data).every(value=>Number.isSafeInteger(value)&&value>=0))
   throw new Error('Коммерческий итог заказа содержит недопустимую сумму.')
 if(data.returnedGoodsValue>data.grossTotal)
   throw new Error('Стоимость возвращённых часов превышает действующий итог продажи. Нужна сверка.')
 return data
}
