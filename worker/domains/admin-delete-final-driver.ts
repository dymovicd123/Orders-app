// A future authenticated admin-only route can use this real adapter once the
// entire deletion lifecycle (including financial audit) passes Cloudflare D1 E2E.
// It is NOT wired into the current Worker router.
import type { AuthUser } from '../core/types.ts'
import { CriticalOperationConflictError } from './critical.ts'
import { deleteOrderSafely } from './order-delete.ts'
import type { FinalOrderDelete } from './admin-delete-finalize.ts'

export function createRealAdminOrderDeleteFinalAction(actor:AuthUser):FinalOrderDelete{
  if(actor?.role!=='admin')
    throw new CriticalOperationConflictError('Окончательное удаление разрешено только администратору.')
  return (db,orderId,input)=>deleteOrderSafely(db,orderId,input,actor,'admin')
}
