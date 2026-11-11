/** Presentation-only labels for warehouse reports. Backend identifiers stay unchanged. */
const translations:Record<string,string>={
  all:'Все', warehouse:'Склад', boutique:'Бутик', workshop:'Цех',
  adult:'Взрослые', child:'Детские', unknown:'Не указано',
  standard:'Стандарт', default:'Стандарт', unspecified:'Не указано',
  male:'Мужской', female:'Женский', unisex:'Унисекс',
  men:'Мужской', women:'Женский',
  present:'Присутствует', absent:'Отсутствует',
}
const sourceNames:Record<string,string>={
  all:'Все источники', warehouse:'Склад',boutique:'Бутик',workshop:'Цех',
}
const categoryNames:Record<string,string>={
  all:'Все категории', adult:'Взрослые',child:'Детские',unknown:'Не указано',
}
export function labelSource(value:string):string{
  const raw=String(value||'').trim()
  return sourceNames[raw.toLowerCase()]||raw||'Не указано'
}
export function labelCategory(value:string):string{
  const raw=String(value||'').trim()
  return categoryNames[raw.toLowerCase()]||raw||'Не указано'
}
/** Translate only known internal codes; never translate proper catalog model names. */
export function labelCharacteristic(value:string):string{
  const raw=String(value||'').trim()
  return translations[raw.toLowerCase()]||raw||'Не указано'
}
export const labelSourceFilter=(value:string)=>value==='all'?'Склад и бутик':labelSource(value)
export function labelScope(value:'orders'|'shipped'){
  return value==='shipped'?'Отправленные товары':'Все оформленные заказы'
}
export const integerRu=(value:number)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(value)
export const moneyRu=(value:number)=>integerRu(Math.round(value))+' ₸'
export const percentRu=(value:number,total:number)=>total>0
  ?(Math.round(value/total*1000)/10).toLocaleString('ru-RU',{maximumFractionDigits:1})+' %'
  :'—'
export function dateTimeRu(value:string){
  const date=new Date(value)
  return Number.isNaN(date.getTime())?'Дата не указана':
    new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Almaty',
      year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(date)
}
