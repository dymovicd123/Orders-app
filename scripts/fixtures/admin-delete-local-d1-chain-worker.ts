// CI-ONLY Worker, NEVER imported from production worker/index.ts.
// Uses real execution / cancellation functions and disposable local D1.
import { createRealAdminDeleteCancellationDriver } from '../../worker/domains/admin-delete-real-driver.ts'
import { finalizeAdminDeleteSaga } from '../../worker/domains/admin-delete-finalize.ts'
import {
  advanceAdminDeleteSagaOneStep,getAdminDeleteSagaProgress,
} from '../../worker/domains/admin-delete-saga.ts'

type Env={DB:D1Database}
const saga='REAL_CHAIN_42'
const step={
  orderId:42,sagaRequestId:saga,cancelRequestId:saga+':return:400',
  stepIndex:0,type:'return' as const,id:400
}
async function results(db:D1Database,query:string){
  const rows=await db.prepare(query).all<Record<string,unknown>>()
  return rows.results||[]
}
export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    if(request.headers.get('x-isolated-ci-fixture')!=='allow')
      return new Response('forbidden',{status:403})
    const route=new URL(request.url).pathname
    const driver=createRealAdminDeleteCancellationDriver(env.DB)
    try {
      if(route==='/health')return Response.json({ok:true,fixture:'isolated-chain-d1'})
      if(route==='/preflight'){
        await driver.preflight(step)
        return Response.json({ok:true})
      }
      if(route==='/set-applied'){
        await env.DB.prepare("UPDATE inventory_lifecycle_events SET status='applied' WHERE id=901 AND order_id=42").run()
        return Response.json({ok:true})
      }
      if(route==='/set-pending'){
        await env.DB.prepare("UPDATE inventory_lifecycle_events SET status='pending' WHERE id=901 AND order_id=42").run()
        return Response.json({ok:true})
      }
      if(route==='/set-cancelled'){
        await env.DB.prepare("UPDATE inventory_lifecycle_events SET status='cancelled' WHERE id=901 AND order_id=42").run()
        return Response.json({ok:true})
      }
      if(route==='/set-money'){
        await env.DB.prepare("INSERT INTO payments(id,order_id,amount) VALUES(9,42,500)").run()
        return Response.json({ok:true})
      }
      if(route==='/clear-money'){
        await env.DB.prepare("DELETE FROM payments WHERE id=9 AND order_id=42").run()
        return Response.json({ok:true})
      }
      if(route==='/finalize'||route==='/finalize-interrupted'){
        // Synthetic final order writer ONLY for testing the dormant saga's
        // handoff & checkpoint. Production must instead inject the real
        // deleteOrderSafely adapter from admin-delete-final-driver.ts.
        const deleter=async(db:D1Database,orderId:number,input:{
          requestId:string;expectedSnapshot:string;comment:string
        })=>{
          if(input.requestId!=='REAL_CHAIN_42:final'
            ||! /^[a-f0-9]{64}$/.test(input.expectedSnapshot))
            throw Error('WRONG_FINAL_REQUEST_OWNERSHIP_OR_SNAPSHOT')
          await db.batch([
            db.prepare("SELECT json('STALE_FINAL_ORDER') WHERE NOT EXISTS (SELECT 1 FROM orders WHERE id=? AND order_status='active')").bind(orderId),
            db.prepare("UPDATE orders SET order_status='deleted' WHERE id=? AND order_status='active'").bind(orderId),
            db.prepare("UPDATE inventory_reservations SET status='released' WHERE order_id=? AND status='active'").bind(orderId),
            db.prepare("UPDATE inventory_stock SET reserved_quantity=reserved_quantity-1 WHERE variant_id=10 AND reserved_quantity=1"),
            db.prepare("INSERT INTO critical_operations (request_id,operation_type,status,step,target_type,target_id,response_json) VALUES (?,'order_edit','completed','completed','order',?,'{}')").bind(input.requestId+':order',orderId),
          ])
          if(route==='/finalize-interrupted')
            throw Error('TEST_ONLY_CRASH_AFTER_FINAL_ORDER_DELETE_BEFORE_SAGA_CHECKPOINT')
          return {ok:true}
        }
        return Response.json(await finalizeAdminDeleteSaga(env.DB,saga,deleter))
      }
      if(route==='/progress'){
        return Response.json(await getAdminDeleteSagaProgress(env.DB,saga))
      }
      if(route==='/advance'){
        return Response.json(await advanceAdminDeleteSagaOneStep(env.DB,saga,driver))
      }
      if(route==='/advance-interrupt-checkpoint'){
        // All business SQL is executed against genuine local D1. Only the
        // outer saga checkpoint batch is intercepted, after Return's real
        // business batch has committed. The next request resumes same ID.
        let interrupted=false
        const db={
          prepare:(query:string)=>env.DB.prepare(query),
          batch:async(statements:D1PreparedStatement[])=>{
            const ret=await env.DB.prepare('SELECT status FROM returns WHERE id=400').first<{status:string}>()
            const stage=await env.DB.prepare(
              "SELECT status FROM admin_order_delete_saga_steps WHERE saga_request_id=? AND step_index=0"
            ).bind(saga).first<{status:string}>()
            if(!interrupted&&ret?.status==='cancelled'&&stage?.status==='started'){
              interrupted=true
              throw Error('TEST_ONLY_CRASH_AFTER_RETURN_BEFORE_SAGA_CHECKPOINT')
            }
            return env.DB.batch(statements)
          },
        } as D1Database
        const wrapped=createRealAdminDeleteCancellationDriver(db)
        return Response.json(await advanceAdminDeleteSagaOneStep(db,saga,wrapped))
      }
      if(route==='/facts'){
        const [order,items,exchanges,ret,stock,reservations,events,critical,sagaSteps,finalOperations,payments]=await Promise.all([
          env.DB.prepare('SELECT order_status,total_amount,received_amount,return_amount,debt_amount FROM orders WHERE id=42').first(),
          results(env.DB,'SELECT id,quantity,unit_price,line_total FROM order_items WHERE order_id=42 ORDER BY id'),
          results(env.DB,'SELECT id,status FROM exchanges WHERE order_id=42 ORDER BY id'),
          env.DB.prepare('SELECT id,status FROM returns WHERE id=400').first(),
          results(env.DB,'SELECT variant_id,quantity,reserved_quantity FROM inventory_stock ORDER BY variant_id'),
          results(env.DB,'SELECT id,status FROM inventory_reservations WHERE order_id=42 ORDER BY id'),
          results(env.DB,'SELECT id,status FROM inventory_lifecycle_events WHERE order_id=42 ORDER BY id'),
          results(env.DB,"SELECT request_id,operation_type,status,target_type,target_id FROM critical_operations WHERE operation_type IN ('return_cancel','exchange_set_cancel') ORDER BY request_id"),
          results(env.DB,"SELECT step_index,operation_type,operation_id,status FROM admin_order_delete_saga_steps WHERE saga_request_id='REAL_CHAIN_42' ORDER BY step_index"),
          results(env.DB,"SELECT request_id,operation_type,status,target_type,target_id FROM critical_operations WHERE operation_type='order_edit' ORDER BY request_id"),
          results(env.DB,"SELECT id,amount FROM payments WHERE order_id=42 ORDER BY id"),
        ])
        return Response.json({order,items,exchanges,ret,stock,reservations,events,critical,sagaSteps,finalOperations,payments})
      }
      return new Response('not found',{status:404})
    }catch(error){
      return Response.json({ok:false,error:String(error instanceof Error?error.message:error)},{status:409})
    }
  }
}
