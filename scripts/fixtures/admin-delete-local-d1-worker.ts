// LOCAL CI FIXTURE ONLY. Not imported by worker/index.ts or production routes.
// Dedicated test-only Worker processes actual production cancellation handlers
// using a synthetic D1 binding and a deterministic operation request key.
import { createRealAdminDeleteCancellationDriver } from '../../worker/domains/admin-delete-real-driver.ts'

type TestEnv={DB:D1Database}
const step={
  orderId:42,sagaRequestId:'LOCAL_WORKER_D1_42',
  cancelRequestId:'LOCAL_WORKER_D1_42:return:400',
  stepIndex:0,type:'return' as const,id:400
}
export default {
  async fetch(request:Request,env:TestEnv):Promise<Response>{
    if(request.headers.get('x-isolated-ci-fixture')!=='allow')return new Response('forbidden',{status:403})
    const path=new URL(request.url).pathname
    const driver=createRealAdminDeleteCancellationDriver(env.DB)
    try{
      if(path==='/health')return Response.json({ok:true,fixture:'isolated-local-d1'})
      if(path==='/preflight'){
        await driver.preflight(step)
        return Response.json({ok:true})
      }
      if(path==='/clear-applied-fixture'){
        await env.DB.prepare("DELETE FROM inventory_lifecycle_events WHERE id=99 AND order_id=42").run()
        return Response.json({ok:true})
      }
      if(path==='/cancel' || path==='/cancel-drop-reply'){
        const result=await driver.cancel(step)
        // A response can be lost AFTER real handler DB commit. Repeating the
        // same request key must never apply the business cancellation twice.
        if(path==='/cancel-drop-reply')return Response.json({ok:false,simulatedResponseLost:true},{status:503})
        return Response.json({ok:result?.ok===true})
      }
      if(path==='/verify'){
        return Response.json({reconciled:await driver.verifyReconciled(step)})
      }
      if(path==='/facts'){
        const [ret,op,order,stock]=await Promise.all([
          env.DB.prepare("SELECT status FROM returns WHERE id=400").first(),
          env.DB.prepare("SELECT operation_type,status,target_type,target_id FROM critical_operations WHERE request_id=?").bind(step.cancelRequestId).first(),
          env.DB.prepare("SELECT total_amount,received_amount,return_amount,debt_amount FROM orders WHERE id=42").first(),
          env.DB.prepare("SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=1").first()
        ])
        const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM critical_operations WHERE operation_type='return_cancel'").first()
        return Response.json({ret,op,order,stock,count})
      }
      return new Response('not found',{status:404})
    }catch(error){
      return Response.json({ok:false,error:String(error instanceof Error?error.message:error)},{status:409})
    }
  }
}
