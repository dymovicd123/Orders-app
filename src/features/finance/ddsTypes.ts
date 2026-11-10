export type DdsEntry = {
  id:number;kind:'funding'|'expense'|'reversal_funding'|'reversal_expense'
  businessDate:string;amount:number;category:string;article:string
  comment:string;createdAt:string;reversesEntryId:number|null;reversed:number
}
export type DdsDirectoryArticle={id:number;name:string;active:boolean}
export type DdsDirectoryCategory={id:number;name:string;active:boolean;articles:DdsDirectoryArticle[]}
export type DdsReport = {
  ok:boolean;month:string;currentBalance:number;openingBalance:number;monthAdded:number
  monthSpent:number;closingBalance:number
  categories:Array<{name:string;total:number;articles:Array<{name:string;amount:number}>}>
  entries:DdsEntry[]
  directory:DdsDirectoryCategory[]
}
export const ddsKindLabel:Record<DdsEntry['kind'],string> = {
  funding:'Пополнение', expense:'Расход', reversal_funding:'Отмена пополнения', reversal_expense:'Отмена расхода'
}
export const ddsSignedAmount=(entry:DdsEntry)=>entry.amount*(entry.kind==='funding'||entry.kind==='reversal_expense'?1:-1)
export const ddsMoney=(value:number)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(value)+' ₸'
export const ddsMonthLabel=(month:string)=>new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(month+'-01T12:00:00Z'))
export const ddsDateLabel=(date:string)=>date.split('-').reverse().join('.')
