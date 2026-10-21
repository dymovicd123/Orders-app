// Read-only reason for the one standalone item return that prevents a
// historical handover marker from being rewritten during admin deletion.
// A money-only Return has no return_items and does not block this step.
import {cleanText,toInt} from '../core/text.ts'

export type StandaloneItemReturnBlocker={
  returnId:number
  productName:string
  quantity:number
  awaitingIntake:boolean
  message:string
}

export async function readStandaloneItemReturnBlocker(
  db:D1Database,orderId:number,
):Promise<StandaloneItemReturnBlocker|null>{
  const row=await db.prepare(`
    SELECT r.id AS return_id,ri.product_name_snapshot,
           ri.quantity,ri.physical_tracking,ri.physical_received_at
    FROM returns r
    JOIN return_items ri ON ri.return_id=r.id AND COALESCE(ri.quantity,0)>0
    WHERE r.order_id=?
      AND COALESCE(r.status,'completed')<>'cancelled'
      AND NOT EXISTS(
        SELECT 1 FROM exchanges e
        WHERE e.refund_return_id=r.id
          AND COALESCE(e.status,'completed')<>'cancelled'
      )
    ORDER BY r.id ASC,ri.id ASC LIMIT 1
  `).bind(orderId).first<Record<string,unknown>>()
  if(!row)return null
  const returnId=toInt(row.return_id,0)
  const productName=cleanText(row.product_name_snapshot)||'товар'
  const quantity=Math.max(0,toInt(row.quantity,0))
  const awaitingIntake=toInt(row.physical_tracking,0)===1&&!cleanText(row.physical_received_at)
  const status=awaitingIntake?'ожидает приёмки':'имеет записанную физическую историю'
  return {
    returnId,productName,quantity,awaitingIntake,
    message:`Удалению мешает самостоятельный возврат #${returnId}: «${productName}», ${quantity} шт. (${status}). Сначала отмените возврат #${returnId} через «Доп. действия» → «Отменить возврат», затем повторите удаление. Возвраты, созданные обменами, система отменит вместе с обменами.`,
  }
}
