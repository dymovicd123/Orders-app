// HTTP boundary for modern item-scoped order shipments.
// Request authentication and legacy whole-order shipping remain in worker/index.ts.
// Domain functions below own all stock/reservation/ledger transactions.
import { json, publicApiError, readJson } from '../core/http.ts'
import { cleanText, toInt } from '../core/text.ts'
import { getOrder } from '../domains/orders-write.ts'
import { buildOrderShipmentPlan } from '../domains/order-shipment-plan.ts'
import { readPriorIssuedItemIds } from '../domains/order-prior-issued-origin.ts'
import { dispatchSelectedCompleteOrderLines } from '../domains/order-dispatch.ts'
import { DispatchStockConfirmationRequired } from '../domains/order-dispatch-confirmation.ts'
import { cancelExactOrderDispatchItem } from '../domains/order-dispatch-cancel.ts'

/**
 * Return null only when this request does not match one of the modern
 * selective-shipping routes. Preserve the old HTTP responses exactly.
 * The caller must authenticate and apply employee access policy first.
 */
export async function handleOrderSelectiveShippingRoute(
  db: D1Database,
  request: Request,
  pathname: string,
): Promise<Response | null> {
      const orderDispatchesMatch = pathname.match(/^\/api\/orders\/(\d+)\/shipping\/dispatches$/);
      if (orderDispatchesMatch && (request.method === 'GET' || request.method === 'POST')) {
        const orderId = toInt(orderDispatchesMatch[1],0);
        if (request.method === 'GET') {
          const order = await db.prepare('SELECT id FROM orders WHERE id=?')
            .bind(orderId).first<{id:number}>();
          if (!order) return json({ok:false,message:'Заказ не найден.'},{status:404});
          const records = await db.prepare(
            `SELECT d.id AS dispatchId,d.dispatch_date AS dispatchDate,d.created_at AS dispatchedAt,
                    d.status AS dispatchStatus,di.id AS dispatchItemId,di.order_item_id AS orderItemId,
                    di.quantity,di.cancelled_quantity AS cancelledQuantity,
                    EXISTS(SELECT 1 FROM return_items ri JOIN returns r ON r.id=ri.return_id
                      WHERE ri.order_item_id=di.order_item_id AND ri.quantity>0
                        AND COALESCE(r.status,'completed')<>'cancelled') AS hasReturn,
                    EXISTS(SELECT 1 FROM exchanges e WHERE e.order_id=d.order_id
                      AND (e.old_order_item_id=di.order_item_id OR e.new_order_item_id=di.order_item_id)
                        AND COALESCE(e.status,'completed')<>'cancelled') AS hasExchange,
                    di.source_type AS sourceType,oi.product_name_snapshot AS productName,
                    oi.color_snapshot AS color,oi.size_snapshot AS size,
                    oi.material_snapshot AS material,oi.length_snapshot AS length,
                    di.variant_id AS variantId
             FROM order_dispatches d JOIN order_dispatch_items di ON di.dispatch_id=d.id
             JOIN order_items oi ON oi.id=di.order_item_id
             WHERE d.order_id=? ORDER BY d.id DESC,di.id`
          ).bind(orderId).all<Record<string,unknown>>();
          return json({ok:true,dispatches:records.results||[]});
        }
        try {
          const input=await readJson<{ requestId?:unknown; items?:unknown; dispatchDate?:unknown; stockConfirmations?:unknown }>(request);
          const items=Array.isArray(input.items) ? input.items.map((row:any)=>({
            orderItemId:Number(row?.orderItemId),quantity:Number(row?.quantity)
          })) : [];
          const result=await dispatchSelectedCompleteOrderLines(db,orderId,{
            requestId:cleanText(input.requestId),items,
            dispatchDate:cleanText(input.dispatchDate),
            actor:cleanText(request.headers.get('X-Access-User'))||'Сотрудник',
            stockConfirmations:input.stockConfirmations as any,
          });
          let updatedOrder=null;
          try { updatedOrder=await getOrder(db,orderId) }
          catch(error) { console.warn('Dispatch committed; order readback failed',error) }
          return json({...result,...(updatedOrder?{order:updatedOrder}:{}),refreshRequired:!updatedOrder});
        }catch(error){
          if(error instanceof DispatchStockConfirmationRequired){
            return json({ok:false,code:error.code,message:error.message,items:error.items},{status:409})
          }
          const e=publicApiError(error);
          return json({ok:false,...(e.code?{code:e.code}:{}),message:e.message},{status:e.status});
        }
      }

      const orderDispatchItemCancelMatch = pathname.match(/^\/api\/orders\/(\d+)\/shipping\/dispatch-items\/(\d+)\/correct$/);
      if(orderDispatchItemCancelMatch && request.method==='POST'){
        const orderId=toInt(orderDispatchItemCancelMatch[1],0);
        const dispatchItemId=toInt(orderDispatchItemCancelMatch[2],0);
        try {
          const input=await readJson<{requestId?:unknown;reason?:unknown}>(request);
          const result=await cancelExactOrderDispatchItem(db,orderId,{
            dispatchItemId,requestId:cleanText(input.requestId),
            actor:cleanText(request.headers.get('X-Access-User'))||'Сотрудник',
            reason:cleanText(input.reason),
          });
          let updatedOrder=null;
          try { updatedOrder=await getOrder(db,orderId) }
          catch(error){console.warn('Dispatch correction committed; order readback failed',error)}
          return json({...result,...(updatedOrder?{order:updatedOrder}:{}),refreshRequired:!updatedOrder});
        }catch(error){
          const e=publicApiError(error);
          return json({ok:false,...(e.code?{code:e.code}:{}),message:e.message},{status:e.status});
        }
      }

      const orderShippingPlanMatch = pathname.match(/^\/api\/orders\/(\d+)\/shipping\/plan$/);
      if (orderShippingPlanMatch && request.method === 'GET') {
        const orderId = toInt(orderShippingPlanMatch[1], 0);
        const order = await getOrder(db, orderId);
        if (!order) return json({ok:false,message:'Заказ не найден.'},{status:404});
        const activeReservations = await db.prepare(
          `SELECT order_item_id, quantity, status, variant_id, inventory_source
           FROM inventory_reservations WHERE order_id = ? AND status IN ('active','unresolved','fulfilled')
           ORDER BY order_item_id ASC, id ASC`
        ).bind(orderId).all<Record<string,unknown>>();
        return json(buildOrderShipmentPlan(
          order as Parameters<typeof buildOrderShipmentPlan>[0],
          (activeReservations.results || []) as Parameters<typeof buildOrderShipmentPlan>[1],
          await readPriorIssuedItemIds(db, orderId),
        ));
      }

  return null;
}
