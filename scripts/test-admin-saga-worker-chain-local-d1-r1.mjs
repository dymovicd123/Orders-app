// Full 3-step real cancellation saga through a real local workerd Worker + D1.
// All data are synthetic, generated into an OS temp dir; never remote D1.
// Only the throw between business commit and saga checkpoint is injected.
import assert from 'node:assert/strict'
import { spawn,spawnSync } from 'node:child_process'
import { mkdtempSync,mkdirSync,rmSync,writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { buildLocalChainSeed } from './fixtures/admin-delete-worker-chain-seed.mjs'
import { localRealFinalSchema } from './fixtures/admin-delete-real-final-d1-schema.mjs'

const temp=mkdtempSync(join(tmpdir(),'orders-chain-real-d1-'))
const persist=join(temp,'db')
const config=join(temp,'wrangler.json')
const name='orders_admin_chain_ci_only'
const cli=resolve('node_modules/wrangler/bin/wrangler.js')
const url='http://127.0.0.1:8974'
mkdirSync(persist)
writeFileSync(config,JSON.stringify({
  name:'orders-admin-chain-ci-only',
  main:resolve('scripts/fixtures/admin-delete-local-d1-chain-worker.ts'),
  compatibility_date:'2026-07-06',compatibility_flags:['nodejs_compat'],
  d1_databases:[{
    binding:'DB',database_name:name,
    database_id:'00000000-0000-4000-8000-000000000003'
  }]
}))
const env={...process.env,CI:'true',WRANGLER_SEND_METRICS:'false',
  CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:''}
function execute(file){
  const p=spawnSync(process.execPath,[cli,'d1','execute',name,
    '--config',config,'--local','--persist-to',persist,'--file',resolve(file)],{
    encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024,env,
  })
  if(p.error)throw p.error
  assert.equal(p.status,0,'Local D1 setup failed '+file+'\n'+p.stdout+'\n'+p.stderr)
}
let child=null
let log=''
async function probe(path){
  const res=await fetch(url+path,{
    headers:{'x-isolated-ci-fixture':'allow'},
    signal:AbortSignal.timeout(8000)
  })
  return {status:res.status,data:await res.json()}
}
const statuses=(items)=>items.map(x=>[x.id,x.status])
try{
  const seed=buildLocalChainSeed()
  const baseline=join(temp,'baseline.sql')
  const journal=join(temp,'journal.sql')
  writeFileSync(baseline,seed.baseline)
  writeFileSync(journal,seed.journal)
  execute(baseline)
  if(process.argv.includes('--real')||process.argv.includes('--race')){
    const schema=join(temp,'real-final-fixture.sql')
    writeFileSync(schema,localRealFinalSchema())
    execute(schema)
  }
  execute('migrations/0110_v72_exchange_order_item_price_correction_audit.sql')
  execute('migrations/0111_v72_admin_order_delete_saga_journal.sql')
  execute(journal)

  child=spawn(process.execPath,[cli,'dev','--local','--config',config,
    '--persist-to',persist,'--ip','127.0.0.1','--port','8974'],{
    env,stdio:['ignore','pipe','pipe']
  })
  for(const stream of [child.stdout,child.stderr]){
    stream.setEncoding('utf8')
    stream.on('data',chunk=>{log=(log+chunk).slice(-20000)})
  }
  let ready=false
  for(let i=0;i<90;i++){
    if(child.exitCode!==null)throw Error('Local workerd crashed: '+child.exitCode+'\n'+log)
    try{
      const r=await probe('/health')
      if(r.status===200&&r.data.fixture==='isolated-chain-d1'){ready=true;break}
    }catch{}
    await delay(500)
  }
  assert(ready,'Local Worker did not become ready:\n'+log)
  const initial=await probe('/facts')
  assert.equal(initial.status,200)
  assert.equal(initial.data.order.total_amount,25000)
  assert.deepEqual(statuses(initial.data.exchanges),[[200,'completed'],[201,'completed']])
  assert.deepEqual(initial.data.stock.map(s=>[s.variant_id,s.quantity,s.reserved_quantity]),
    [[10,5,0],[11,3,0],[12,4,1]])
  assert.equal(initial.data.critical.length,0)

  // A physical event applied after the initial saga plan must block BEFORE
  // executing the first dependent cancellation, not after touching stock.
  assert.equal((await probe('/set-applied')).status,200)
  const blocked=await probe('/advance')
  assert.equal(blocked.status,409)
  assert.match(blocked.data.error,/проведённые физические складские движения/)
  let progress=await probe('/progress')
  assert.equal(progress.data.nextStep,0)
  assert.equal((await probe('/facts')).data.critical.length,0)
  assert.equal((await probe('/set-pending')).status,200)

  // Real Return cancellation commits, but the outer saga checkpoint fails.
  // The next HTTP request must resume exactly the same cancellation key.
  const lostCheckpoint=await probe('/advance-interrupt-checkpoint')
  assert.equal(lostCheckpoint.status,409)
  assert.match(lostCheckpoint.data.error,/TEST_ONLY_CRASH_AFTER_RETURN_BEFORE_SAGA_CHECKPOINT/)
  progress=await probe('/progress')
  assert.equal(progress.data.nextStep,0)
  const afterCrash=await probe('/facts')
  assert.equal(afterCrash.data.ret.status,'cancelled')
  assert.deepEqual(afterCrash.data.sagaSteps.map(x=>x.status),['started','pending','pending'])
  assert.equal(afterCrash.data.critical.length,1)
  assert.deepEqual([afterCrash.data.critical[0].operation_type,
    afterCrash.data.critical[0].status,
    afterCrash.data.critical[0].target_type,
    afterCrash.data.critical[0].target_id],
    ['return_cancel','completed','return',400])
  assert.deepEqual(afterCrash.data.stock.map(s=>[s.variant_id,s.quantity,s.reserved_quantity]),
    [[10,5,0],[11,3,0],[12,4,1]])

  for(const expected of [1,2,3]){
    const result=await probe('/advance')
    assert.equal(result.status,200,'Real saga step '+expected+
      ' failed: '+JSON.stringify(result.data))
    assert.equal(result.data.nextStep,expected)
    assert.equal(result.data.status,
      expected===3?'ready_for_final_delete':'running')
  }
  const final=await probe('/facts')
  assert.equal(final.status,200)
  assert.deepEqual(statuses(final.data.exchanges),[[200,'cancelled'],[201,'cancelled']])
  assert.deepEqual(final.data.ret,{id:400,status:'cancelled'})
  assert.deepEqual(final.data.items.map(i=>[i.id,i.quantity,i.unit_price,i.line_total]),
    [[1,1,20000,20000],[2,0,23000,0],[3,0,25000,0]])
  assert.deepEqual(final.data.stock.map(s=>[s.variant_id,s.quantity,s.reserved_quantity]),
    [[10,5,1],[11,3,0],[12,4,0]])
  assert.deepEqual(statuses(final.data.reservations),
    [[100,'active'],[101,'released'],[102,'released']])
  assert.deepEqual(statuses(final.data.events),
    [[900,'cancelled'],[901,'cancelled']])
  assert.deepEqual(final.data.order,{
    order_status:'active',total_amount:20000,received_amount:0,
    return_amount:0,debt_amount:20000
  },'The order must NOT be finally deleted by a cancellation saga')
  assert.deepEqual(final.data.sagaSteps.map(x=>[x.operation_type,x.operation_id,x.status]),
    [['return',400,'completed'],['exchange',201,'completed'],['exchange',200,'completed']])
  assert.deepEqual(final.data.critical.map(x=>[
    x.request_id,x.operation_type,x.status,x.target_type,x.target_id
  ]),[
    ['REAL_CHAIN_42:exchange:200','exchange_set_cancel','completed','exchange',200],
    ['REAL_CHAIN_42:exchange:201','exchange_set_cancel','completed','exchange',201],
    ['REAL_CHAIN_42:return:400','return_cancel','completed','return',400]
  ])
  const replay=await probe('/advance')
  assert.equal(replay.status,200)
  assert.equal(replay.data.status,'ready_for_final_delete')
  assert.equal(replay.data.nextStep,3)
  assert.deepEqual((await probe('/facts')).data,final.data,
    'Replay must not mutate the historical order, money or stock after completion')
  // Final order deletion starts only AFTER all real Return/V2 steps completed.
  // A physical event or money discovered after the completed cancellation
  // must block the finalizer before the delegated delete callback can run.
  assert.equal((await probe('/set-applied')).status,200)
  const physicalBlock=await probe('/finalize')
  assert.equal(physicalBlock.status,409)
  assert.match(physicalBlock.data.error,/физические движения|склад|штатный/i)
  assert.equal((await probe('/progress')).data.status,'ready_for_final_delete')
  assert.equal((await probe('/set-cancelled')).status,200)

  assert.equal((await probe('/set-money')).status,200)
  const paymentBlock=await probe('/finalize')
  assert.equal(paymentBlock.status,409)
  assert.match(paymentBlock.data.error,/деньги|оплат|финансов/i)
  assert.equal((await probe('/clear-money')).status,200)
  let unfinished=await probe('/facts')
  assert.equal(unfinished.data.order.order_status,'active')
  assert.equal(unfinished.data.finalOperations.length,0)
  assert.deepEqual(unfinished.data.stock.map(x=>[x.variant_id,x.quantity,x.reserved_quantity]),
    [[10,5,1],[11,3,0],[12,4,0]])

  if(process.argv.includes('--real')||process.argv.includes('--race')){
    const race=process.argv.includes('--race')
    if(race){
      const replies=await Promise.all([
        probe('/finalize-real'),probe('/finalize-real')
      ])
      assert(replies.some(r=>r.status===200&&r.data.status==='completed'),
        'At least one racing admin should finish: '+JSON.stringify(replies))
      assert(replies.every(r=>r.status===200||r.status===409),
        'Concurrent delete must not produce an unexpected failure: '+JSON.stringify(replies))
    }else{
      const interrupted=await probe('/finalize-real-interrupted')
      assert.equal(interrupted.status,409,
        'Real delete must commit before test-only dropped reply: '+JSON.stringify(interrupted))
      assert.match(interrupted.data.error,/TEST_ONLY_LOST_REAL_DELETE_RESPONSE_AFTER_CRITICAL_COMPLETE/)
      assert.equal((await probe('/progress')).data.status,'ready_for_final_delete')
    }
    const justDeleted=await probe('/facts')
    assert.equal(justDeleted.data.order.order_status,'deleted')
    assert.equal(justDeleted.data.finalOperations.length,1)
    assert.deepEqual(justDeleted.data.finalOperations[0],{
      request_id:'REAL_CHAIN_42:final:order',
      operation_type:'order_edit',status:'completed',target_type:'order',target_id:42
    })
    assert.deepEqual(statuses(justDeleted.data.reservations),[
      [100,'released'],[101,'released'],[102,'released']
    ])
    assert.deepEqual(justDeleted.data.stock.map(x=>[
      x.variant_id,x.quantity,x.reserved_quantity
    ]),[[10,5,0],[11,3,0],[12,4,0]])
    assert.deepEqual(justDeleted.data.exchanges,final.data.exchanges)
    assert.deepEqual(justDeleted.data.events,final.data.events)
    assert.deepEqual(justDeleted.data.critical,final.data.critical)
    assert.equal(justDeleted.data.payments.length,0)
    const firstRetry=await probe('/finalize-real')
    assert.equal(firstRetry.status,200,'Retry real deletion: '+JSON.stringify(firstRetry))
    assert.equal(firstRetry.data.status,'completed')
    assert.equal((await probe('/finalize-real')).data.status,'completed')
    assert.equal((await probe('/advance')).data.status,'completed')
    const afterRetry=await probe('/facts')
    assert.deepEqual(afterRetry.data,justDeleted.data,
      'Real delete must not double release stock, rewrite money or erase history')
    console.log(race
      ?'ACTUAL_DELETE_ORDER_SAFELY_LOCAL_D1_CONCURRENT_ADMIN_REPLAY_PASSED'
      :'ACTUAL_DELETE_ORDER_SAFELY_LOCAL_D1_LOST_REPLY_REPLAY_PASSED')
  }else{
  // The test-only order deleter commits a logical deletion & release on D1,
  // but a thrown response simulates losing the journal checkpoint afterward.
  const interrupted=await probe('/finalize-interrupted')
  assert.equal(interrupted.status,409)
  assert.match(interrupted.data.error,/TEST_ONLY_CRASH_AFTER_FINAL_ORDER_DELETE_BEFORE_SAGA_CHECKPOINT/)
  progress=await probe('/progress')
  assert.equal(progress.data.status,'ready_for_final_delete')
  assert.equal(progress.data.nextStep,3)
  const deletedUncheckpointed=await probe('/facts')
  assert.equal(deletedUncheckpointed.data.order.order_status,'deleted')
  assert.deepEqual(deletedUncheckpointed.data.finalOperations,[{
    request_id:'REAL_CHAIN_42:final:order',operation_type:'order_edit',
    status:'completed',target_type:'order',target_id:42
  }])
  assert.deepEqual(deletedUncheckpointed.data.stock.map(x=>[
    x.variant_id,x.quantity,x.reserved_quantity
  ]),[[10,5,0],[11,3,0],[12,4,0]])
  assert.deepEqual(statuses(deletedUncheckpointed.data.reservations),
    [[100,'released'],[101,'released'],[102,'released']])

  // The exact same saga key must finish using the completed order_edit
  // fingerprint/target record and MUST NOT call the deletion again.
  const complete=await probe('/finalize')
  assert.equal(complete.status,200,JSON.stringify(complete.data))
  assert.equal(complete.data.status,'completed')
  assert.equal(complete.data.nextStep,3)
  assert.equal((await probe('/finalize')).data.status,'completed')
  assert.equal((await probe('/advance')).data.status,'completed')
  const finalDeleted=await probe('/facts')
  assert.deepEqual(finalDeleted.data,deletedUncheckpointed.data,
    'Repeated delete must preserve the same stock, history and money')
  assert.deepEqual(finalDeleted.data.events,final.data.events)
  assert.deepEqual(finalDeleted.data.critical,final.data.critical)
  assert.equal(finalDeleted.data.payments.length,0)
  console.log('FINAL_DELETE_DORMANT_SAGA_HANDOFF_CRASH_RECOVERY_PASSED')
  }
  console.log('REAL_WORKER_D1_RETURN_TWO_V2_EXCHANGES_CHECKPOINT_CRASH_REPLAY_PASSED')
}finally{
  if(child){
    child.kill('SIGTERM')
    await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(3500)])
    if(child.exitCode===null)child.kill('SIGKILL')
  }
  rmSync(temp,{recursive:true,force:true})
}
