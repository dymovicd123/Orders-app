// Security contract: manager cannot reach the full editor by UI, stale tab,
// crafted PATCH, or pre-existing form. Manager metadata/price remain isolated.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {updateOrderCritical} from '../worker/domains/orders-write.ts'
import {projectOrderOperationalState} from '../src/app/orderOperationalProjection.ts'

const project=readFileSync('src/app/orderOperationalProjection.ts','utf8')
const table=readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
const details=readFileSync('src/features/sections/OrderDetailsSection.tsx','utf8')
const returnsView=readFileSync('src/features/sections/OrderReturnsSection.tsx','utf8')
const editor=readFileSync('src/features/sections/OrderEditorSection.tsx','utf8')
const app=readFileSync('src/App.tsx','utf8')
const worker=readFileSync('worker/domains/orders-write.ts','utf8')
const router=readFileSync('worker/index.ts','utf8')
const metadata=readFileSync('scripts/test-safe-order-metadata-edit-20261017.mjs','utf8')
const price=readFileSync('scripts/test-order-recorded-price-correction-r1.mjs','utf8')
const ordinary={order_status:'active',shipping_status:'not_sent',items:[
 {sourceType:'warehouse',quantity:1}],received_amount:1000,total_amount:2000,
 debt_amount:1000,return_amount:0,committed_exchange_count:0,committed_return_count:0}
assert.equal(projectOrderOperationalState(ordinary,{isAdmin:true}).canEdit,true)
assert.equal(projectOrderOperationalState(ordinary,{isAdmin:false}).canEdit,false)
assert.equal(projectOrderOperationalState({...ordinary,shipping_status:'sent'},{isAdmin:true}).canEdit,true,
  'Admin may inspect/edit shipped order metadata while server protects physical re-rewrite')
assert.equal(projectOrderOperationalState({...ordinary,shipping_status:'sent'},{isAdmin:false}).canEdit,false)
assert.equal(projectOrderOperationalState({...ordinary,committed_exchange_count:1},{isAdmin:true}).canEdit,false,
  'Completed Exchange still requires isolated price/metadata instead of unsafe composition rewrite')
assert.equal(projectOrderOperationalState({...ordinary,order_status:'archived'},{isAdmin:true}).canEdit,false)

assert(project.includes('canEdit: mutableWorkingOrder && !hasCommittedDownstreamOperation && simpleAdmin'),
  'Complete order editor must require admin in one shared projection')
assert(table.includes('projectOrderOperationalState(order, { isAdmin })'))
assert(details.includes('projectOrderOperationalState(selectedOrder, { isAdmin })'))
assert(returnsView.includes('isAdmin ? (')&&returnsView.includes('handleEditOrder(returnSelectedOrder)'),
  'Returns must never offer full editor button to manager')
assert(editor.includes('display: isAdmin && selectedOrder && projection?.canEdit'))
assert(!editor.includes('<option value="deleted">'), 'Admin delete must use consequence preview, not legacy editor')
assert(app.includes('if (!isAdmin) { setMessage(\'Полное редактирование доступно только администратору.'))
assert(app.includes("if (!isAdmin) {\n      setError('Полный редактор доступен только администратору."), 'Stale editor submit must be denied')
assert(router.includes('const result = await updateOrderCritical('))
assert(worker.includes("fields.length===1 && fields[0]==='metadataCorrection'"))
assert(worker.includes("fields.length===1 && fields[0]==='itemPriceCorrections'"))
assert(worker.includes("options.lifecycleAction!=='order_delete'"))
assert(metadata.includes('metadataCorrection') && price.includes('itemPriceCorrections'))
assert(app.includes('const payload={metadataCorrection:{expected,next,expectedState}}'))
assert(app.includes('itemPriceCorrections: changes.map'), 'Existing manager price-batch editor must remain available')
assert(app.includes('return {...result.preview,activeSaga:null}'), 'Reuse already verified server deletion preview to avoid duplicate D1 queries')
assert(app.includes('return await loadAdminOrderDeletePreview(order)'), 'Fallback must remain for legacy servers')
assert(app.includes('if (!isItemizedEdit || isItemizedContentRewrite) void loadWorkshopData()'),
  'Price/metadata edit should avoid redundant workshop read, without breaking composition edits')

const manager={role:'manager',id:12,displayName:'Test manager'}
const admin={role:'admin',id:1,displayName:'Test admin'}
const invalid=[
  {},
  {orderDate:'2026-10-18',customerName:'A'},
  {orderStatus:'deleted'},
  {items:[{quantity:1,productName:'A'}]},
  {paymentCorrections:[{paymentId:1,amount:5000}]},
  {itemContentReplacement:{items:[],expectedItems:[]}},
  {itemPriceCorrections:[{orderItemId:1,unitPrice:500}],city:'inject'},
  {metadataCorrection:{expected:{},next:{}},paymentCorrections:[]},
  {itemPriceCorrections:[]},
]
let prepareCalls=0
const db={prepare(){prepareCalls++;throw new Error('REACHED_DATABASE_AFTER_PERMISSION_GATE')}}
for(const payload of invalid){
  const start=prepareCalls
  await assert.rejects(
    updateOrderCritical(db,9,{...payload,requestId:'permission-test'},manager,'manager'),
    /Полное редактирование заказа доступно только администратору|Удаление выполняется только отдельным действием/,
    'Manager must be denied before any DB read or lease: '+JSON.stringify(payload)
  )
  assert.equal(prepareCalls,start,'Rejected manager PATCH touched D1')
}
const allowed=[
 {metadataCorrection:{expected:{},next:{},expectedState:{}}},
 {itemPriceCorrections:[{orderItemId:1,unitPrice:500,expectedUnitPrice:400}]},
]
for(const payload of allowed){
  await assert.rejects(
    updateOrderCritical(db,9,{...payload,requestId:'permission-test'},manager,'manager'),
    /REACHED_DATABASE_AFTER_PERMISSION_GATE/,
    'Narrow manager request should pass ROLE validation and reach normal CAS contract'
  )
}
await assert.rejects(
  updateOrderCritical(db,9,{items:[{quantity:1}],orderDate:'2026-10-18'},admin,'admin'),
  /REACHED_DATABASE_AFTER_PERMISSION_GATE/,
  'Admin full editor should pass role gate and reach original validation pipeline'
)
await assert.rejects(
  updateOrderCritical(db,9,{orderStatus:'deleted'},admin,'admin'),
  /Удаление выполняется только отдельным действием/,
  'Even admin must use the reviewed order-delete path'
)
console.log('ADMIN_FULL_EDITOR_MANAGER_ISOLATED_PATCH_AND_FAST_PREVIEW_REGRESSION_PASSED')
