import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { projectOrderOperationalState } from '../src/app/orderOperationalProjection.ts'

const app=readFileSync('src/App.tsx','utf8')
const session=readFileSync('src/features/orders/orderEditSessionActions.ts','utf8')
const persistence=readFileSync('src/features/orders/orderEditPersistenceActions.ts','utf8')
const backend=readFileSync('worker/domains/orders-write.ts','utf8')
const table=readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
assert(app.includes("const canManageOrderEdit = isAdmin || authUser?.employeeRole === 'Завсклад'"))
assert(app.includes('return projectOrderOperationalState(order, { isAdmin: canManageOrderEdit })'),
 'full order fetch must use same permission as button')
assert(app.includes('createOrderEditSessionActions({\n    isAdmin: canManageOrderEdit,'))
assert(app.includes('createOrderEditPersistenceActions({\n    isAdmin: canManageOrderEdit,'),
 'save must use same permission as opening editor')
assert(app.includes('isAdmin: canManageOrderEdit, isArchivedOrderRecord'))
assert(session.includes('if (!projection.canEdit)'))
assert(persistence.includes('if (!projection.canEdit)'))
assert(backend.includes("const canFullyEdit = actor?.role==='admin' || actor?.employeeRole==='Завсклад'"))
assert(backend.includes("if(!canFullyEdit && options.lifecycleAction!=='order_delete'"))
assert(table.includes('if(projection.canEdit)handleEditOrder(order'))
assert(table.includes('else setLinkedAdminEditOrder(order)'),
 'post Return/Exchange must open the existing narrow correction modal')
const normal={
 id:98,order_status:'active',shipping_status:'not_sent',pricing_mode:'itemized_v1',
 received_amount:8000,return_amount:0,debt_amount:1000,committed_return_count:0,
 committed_exchange_count:0,has_committed_item_return:false,
 items:[{id:5,sourceType:'workshop',isWorkshop:true,workshopTaskStatus:'active'}],
}
const withAdminRight=projectOrderOperationalState(normal,{isAdmin:true})
assert.equal(withAdminRight.canEdit,true,'ordinary unfinished workshop order should be editable by privileged staff')
assert.equal(withAdminRight.workshopPending,true)
assert.equal(projectOrderOperationalState(normal,{isAdmin:false}).canEdit,false)
const returned={...normal,committed_return_count:1}
assert.equal(projectOrderOperationalState(returned,{isAdmin:true}).canEdit,false)
assert.equal(projectOrderOperationalState({...normal,committed_exchange_count:1},{isAdmin:true}).canEdit,false)
assert.equal(projectOrderOperationalState({...normal,order_status:'archived'},{isAdmin:true}).canEdit,false)
assert.equal(projectOrderOperationalState({...normal,retained_only:true},{isAdmin:true}).canEdit,false)
assert.equal(projectOrderOperationalState({...normal,order_status:'deleted'},{isAdmin:true}).canEdit,false)
assert.equal(projectOrderOperationalState({...normal,return_amount:300,committed_return_count:0},{isAdmin:true}).canEdit,true,
 'refund total alone must not be mistaken for committed return')
console.log('BRANCH2_SUPERVISOR_EDITOR_GATE_PASS: button, fresh detail, opening, saving, server all align; Return/Exchange remain blocked')
