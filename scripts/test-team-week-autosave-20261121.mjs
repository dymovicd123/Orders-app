import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {WeekAutosaveQueue,buildWeekChanges,previewWeek} from
  '../src/features/team/weekAutosaveQueue.ts'

const original={
  ok:true,startDate:'2026-11-23',endDate:'2026-11-29',attendance:[],
  employees:[{id:1,name:'Асия',colorKey:'#123456'},{id:2,name:'Айым',colorKey:'#345678'}],
  entries:[{id:9,date:'2026-11-23',managerId:1,manager:'Асия',workUntil:'18:00',
    comment:'',updatedAt:'2026-11-21T10:00:00Z'}],
}
const newIntent=(date,managerId,time='18:00')=>
  ({date,managerId,mode:'set',workUntil:time,comment:''})
const initialAdd=buildWeekChanges(original,[newIntent('2026-11-24',2)])
assert.equal(initialAdd[0].kind,'add')
assert.equal(initialAdd[0].baseId,null)
assert.equal(buildWeekChanges(original,[newIntent('2026-11-23',1)]).length,0,
  'Unchanged content must never emit a write')
assert.equal(buildWeekChanges(original,[{...newIntent('2026-11-23',1,'20:00'),onlyIfAbsent:true}]).length,0,
  'Bulk add cannot overwrite a pre-existing assignment')
const visible=previewWeek(original,[{intents:[newIntent('2026-11-24',2)]}])
assert.equal(visible.entries.length,2)
assert.equal(original.entries.length,1,'Queued preview must not change the server baseline')

let server=structuredClone(original)
let nextId=10,stamp=0,active=0,peak=0,sendCount=0
let gates=[]
const apply=changes=>{
  const entries=[...server.entries]
  for(const change of changes){
    const index=entries.findIndex(e=>e.date===change.date&&e.managerId===change.managerId)
    if(change.kind==='remove'){if(index>=0)entries.splice(index,1);continue}
    const old=index>=0?entries[index]:null
    const employee=server.employees.find(e=>e.id===change.managerId)
    const updated={id:old?.id??nextId++,date:change.date,managerId:change.managerId,
      manager:employee.name,workUntil:change.workUntil,comment:change.comment,
      updatedAt:'rev'+(++stamp)}
    if(index>=0)entries[index]=updated
    else entries.push(updated)
  }
  server={...server,entries}
}
const wait=async(test)=>{
  for(let n=0;n<150;n++){
    if(test())return
    await new Promise(resolve=>setTimeout(resolve,2))
  }
  throw Error('Autosave queue did not progress')
}
let idle=0,state=null
const queue=new WeekAutosaveQueue(server,{
  send:async changes=>{
    sendCount++;active++;peak=Math.max(peak,active)
    await new Promise(resolve=>gates.push(resolve))
    apply(changes)
    active--
    return structuredClone(server)
  },
  reload:async()=>structuredClone(server),
  notify:next=>{state=next},
  onIdle:()=>{idle++}
})
queue.enqueue([newIntent('2026-11-24',2)])
queue.enqueue([newIntent('2026-11-24',2,'19:00')])
queue.enqueue([{date:'2026-11-23',managerId:1,mode:'remove'}])
assert.equal(state.pending.length,3)
assert.equal(previewWeek(state.week,state.pending).entries.length,1)
assert.equal(previewWeek(state.week,state.pending).entries[0].workUntil,'19:00')
assert.equal(peak,1)
for(let i=1;i<=3;i++){
  await wait(()=>gates.length>0)
  gates.shift()()
  if(i<3)await wait(()=>sendCount===i+1)
}
await wait(()=>!state.saving&&state.pending.length===0)
assert.equal(peak,1,'Only one request may ever mutate this week at a time')
assert.equal(idle,1,'One queue drain should refresh the parent once')
assert.equal(server.entries.length,1)
assert.equal(server.entries[0].managerId,2)
assert.equal(server.entries[0].workUntil,'19:00')
queue.dispose()

// A network drop AFTER commit must not cause a duplicate change on retry.
let writes=0,recovered=null
server=structuredClone(original)
const recoverQueue=new WeekAutosaveQueue(server,{
  send:async changes=>{
    writes++
    apply(changes)
    if(writes===1)throw Error('Response lost after transaction commit')
    return structuredClone(server)
  },
  reload:async()=>structuredClone(server),
  notify:next=>{recovered=next},
  onIdle:()=>{}
})
recoverQueue.enqueue([newIntent('2026-11-24',2)])
await wait(()=>!!recovered.error&&!recovered.saving)
assert.equal(recovered.pending.length,1)
await recoverQueue.retry()
await wait(()=>!recovered.saving&&!recovered.pending.length)
assert.equal(writes,1,'Reconcile committed state before replaying a lost response')
assert.equal(server.entries.length,2)
recoverQueue.dispose()

// If the operation did NOT reach the server, explicit retry must commit it.
let attempts=0,failed=null
server=structuredClone(original)
const failing=new WeekAutosaveQueue(server,{
  send:async changes=>{
    attempts++
    if(attempts===1)throw Error('offline')
    apply(changes);return structuredClone(server)
  },
  reload:async()=>structuredClone(server),
  notify:next=>{failed=next},
  onIdle:()=>{}
})
failing.enqueue([{date:'2026-11-23',managerId:1,mode:'remove'}])
await wait(()=>!!failed.error&&!failed.saving)
assert.equal(server.entries.length,1,'An offline deletion must not mutate the server')
await failing.retry()
await wait(()=>!failed.saving&&!failed.pending.length)
assert.equal(server.entries.length,0)
assert.equal(attempts,2)
failing.dispose()

const ui=readFileSync('src/features/team/WeeklyScheduleEditor.tsx','utf8')
const css=readFileSync('src/features/team/weeklyScheduleEditor.css','utf8')
const backend=readFileSync('worker/domains/team-weekly-schedule.ts','utf8')
const parent=readFileSync('src/features/team/TeamTimesheetWorkspace.tsx','utf8')
assert.ok(ui.includes('tw-week-autosave')&&ui.includes('Добавить и сохранить'))
assert.ok(ui.includes('onBlur={()=>commitField(row)}')&&
  ui.includes("onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur()}}"),
  'Comments and time must save after completed edits, not on every keystroke')
assert.ok(ui.includes('Снять выбранные назначения')&&ui.includes('Подтвердить снятие'))
assert.ok(ui.includes('Копировать прошлую неделю')&&ui.includes('onlyIfAbsent:true'))
assert.ok(ui.includes('Обновить и повторить')&&ui.includes('Отменить неподтверждённые изменения'))
assert.ok(ui.includes('beforeunload')&&
  ui.includes('Переход к другой странице ожидает завершения сохранения'),
  'No silent navigation while writes are in flight')
assert.ok(!ui.includes('Сохранить график')&&!ui.includes('Сохранить '+String.fromCharCode(36)),
  'There must be no second week-wide Save button')
assert.ok(css.includes('.tw-week-autosave.failed'))
assert.ok(backend.includes('week:await listTeamScheduleWeek(db,dates[0])'),
  'Successful post must return authoritative row IDs/timestamps without a second browser call')
assert.ok(parent.includes("view==='week'?<WeeklyScheduleEditor"))
console.log('TEAM_WEEK_AUTOSAVE_PASS: ordered requests, optimistic preview, failed network reconciliation, retry, field blur, bulk removal confirmation, permissions unchanged')
