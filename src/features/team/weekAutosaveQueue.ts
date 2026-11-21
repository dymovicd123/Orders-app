import type {TeamTimesheetEntry,TeamTimesheetEmployee,TeamAttendanceMark} from '../../app/types'

export type WeekData={ok:boolean;startDate:string;endDate:string;
  employees:TeamTimesheetEmployee[];entries:TeamTimesheetEntry[];attendance:TeamAttendanceMark[]}
export type WeekIntent={date:string;managerId:number;mode:'set'|'remove';
  workUntil?:string;comment?:string;onlyIfAbsent?:boolean}
export type WeekChange={date:string;managerId:number;kind:'add'|'update'|'remove';
  workUntil:string;comment:string;baseId:number|null;baseUpdatedAt:string;
  baseWorkUntil:string;baseComment:string}
type QueueTask={id:number;intents:WeekIntent[]}
export type WeekQueueState={week:WeekData;pending:QueueTask[];saving:boolean;error:string;
  savedAt:number|null}
const keyOf=(date:string,id:number)=>date+':'+id

export function buildWeekChanges(week:WeekData,intents:WeekIntent[]):WeekChange[]{
  const existing=new Map(week.entries.map(entry=>[keyOf(entry.date,entry.managerId),entry]))
  const distinct=new Map<string,WeekIntent>()
  for(const intent of intents)distinct.set(keyOf(intent.date,intent.managerId),intent)
  const changes:WeekChange[]=[]
  for(const intent of distinct.values()){
    const old=existing.get(keyOf(intent.date,intent.managerId))
    if(intent.mode==='remove'&&!old)continue
    if(intent.mode==='set'&&intent.onlyIfAbsent&&old)continue
    const workUntil=intent.mode==='remove'?old?.workUntil||'':intent.workUntil||''
    const comment=intent.mode==='remove'?old?.comment||'':intent.comment||''
    if(intent.mode==='set'&&old&&old.workUntil===workUntil&&old.comment===comment)continue
    changes.push({
      date:intent.date,managerId:intent.managerId,
      kind:intent.mode==='remove'?'remove':old?'update':'add',
      workUntil,comment,baseId:old?.id??null,
      baseUpdatedAt:old?.updatedAt||'',baseWorkUntil:old?.workUntil||'',
      baseComment:old?.comment||''
    })
  }
  return changes
}
export function previewWeek(week:WeekData,tasks:ReadonlyArray<{intents:WeekIntent[]}>):WeekData{
  const entries=new Map(week.entries.map(entry=>[keyOf(entry.date,entry.managerId),entry]))
  for(const task of tasks)for(const intent of task.intents){
    const key=keyOf(intent.date,intent.managerId)
    const old=entries.get(key)
    if(intent.mode==='remove'){entries.delete(key);continue}
    if(intent.onlyIfAbsent&&old)continue
    const employee=week.employees.find(person=>person.id===intent.managerId)
    entries.set(key,{
      id:old?.id??-(intent.managerId*1000+Number(intent.date.slice(-2))),
      date:intent.date,managerId:intent.managerId,
      manager:old?.manager||employee?.name||'Сотрудник',
      managerColor:old?.managerColor||employee?.colorKey,
      workUntil:intent.workUntil||'',comment:intent.comment||'',
      createdAt:old?.createdAt,updatedAt:old?.updatedAt
    })
  }
  return {...week,entries:[...entries.values()]}
}
export class WeekAutosaveQueue{
  private week:WeekData
  private pending:QueueTask[]=[]
  private saving=false
  private error=''
  private savedAt:number|null=null
  private nextId=1
  private disposed=false
  private notify:(state:WeekQueueState)=>void
  private readonly send:(changes:WeekChange[])=>Promise<WeekData>
  private readonly reload:()=>Promise<WeekData>
  private readonly onIdle:()=>void
  constructor(week:WeekData,options:{
    send:(changes:WeekChange[])=>Promise<WeekData>;
    reload:()=>Promise<WeekData>;
    notify:(state:WeekQueueState)=>void;
    onIdle:()=>void
  }){
    this.week=week
    this.send=options.send
    this.reload=options.reload
    this.notify=options.notify
    this.onIdle=options.onIdle
    this.emit()
  }
  get state():WeekQueueState{
    return {week:this.week,pending:[...this.pending],saving:this.saving,
      error:this.error,savedAt:this.savedAt}
  }
  enqueue(intents:WeekIntent[]){
    if(this.disposed||!intents.length)return
    this.pending.push({id:this.nextId++,intents})
    this.emit()
    void this.drain()
  }
  async retry(){
    if(this.disposed||this.saving||!this.pending.length)return
    this.error=''
    this.saving=true
    this.emit()
    try{
      this.week=await this.reload()
      if(this.disposed)return
      this.error=''
    }catch(cause){
      if(!this.disposed)this.error=cause instanceof Error?cause.message:'Не удалось обновить график.'
      return
    }finally{
      this.saving=false
      this.emit()
    }
    if(!this.disposed)void this.drain()
  }
  async discard(){
    if(this.disposed||this.saving)return
    this.saving=true
    this.emit()
    try{
      const fresh=await this.reload()
      if(this.disposed)return
      this.week=fresh;this.pending=[];this.error=''
    }catch(cause){
      if(!this.disposed)this.error=cause instanceof Error?cause.message:'Не удалось сверить график.'
    }finally{
      this.saving=false;this.emit()
    }
  }
  dispose(){
    this.disposed=true
    this.notify=()=>{}
  }
  private emit(){if(!this.disposed)this.notify(this.state)}
  private async drain(){
    if(this.disposed||this.saving||this.error)return
    this.saving=true;this.emit()
    let wrote=false
    try{
      while(this.pending.length&&!this.disposed){
        const task=this.pending[0]
        const changes=buildWeekChanges(this.week,task.intents)
        if(!changes.length){this.pending.shift();this.emit();continue}
        try{
          const next=await this.send(changes)
          if(this.disposed)return
          this.week=next
          this.pending.shift()
          this.savedAt=Date.now()
          wrote=true
          this.emit()
        }catch(cause){
          if(!this.disposed)this.error=cause instanceof Error?cause.message:'Не удалось сохранить изменение.'
          return
        }
      }
    }finally{
      this.saving=false
      this.emit()
      if(!this.disposed&&wrote&&!this.pending.length&&!this.error)this.onIdle()
    }
  }
}
