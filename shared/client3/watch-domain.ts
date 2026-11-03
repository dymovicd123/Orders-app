/** Client3 watches only. Import explicitly from Client3 routes/components, never from Main. */
export const WATCH_BRANDS = ['TAUWACH', 'WACHIZEN'] as const
export type WatchBrand = typeof WATCH_BRANDS[number]
export type WatchGender = 'male' | 'female'
export type WatchMechanism = string
export type WatchBraceletMaterial = string
export type WatchDialColor = string
export type WatchSource = 'office' | 'showcase'
// Current payment choices are read from the shared Client3 references table.
export type WatchPaymentMethod = string

export const WATCH_DIAL_COLORS = [
  'black','white','silver','gold','green','orange','brown','multicolor',
] as const satisfies readonly WatchDialColor[]
export const WATCH_PAYMENTS = ['KASPI RED','KASPI GOLD','Рассрочка'] as const satisfies readonly WatchPaymentMethod[]

export const WATCH_OPTIONS = {
  brands: WATCH_BRANDS,
  genders: [{value:'male',label:'Мужские'},{value:'female',label:'Женские'}],
  movements: [{value:'quartz',label:'Кварцевые'},{value:'mechanical',label:'Механические'}],
  braceletMaterials: [
    {value:'steel',label:'Стальной'}, {value:'leather',label:'Кожа'}, {value:'rubber',label:'Каучук'},
  ],
  dialColors: [
    {value:'black',label:'Чёрный'}, {value:'white',label:'Белый'},
    {value:'silver',label:'Серебро'}, {value:'gold',label:'Золотистый'},
    {value:'green',label:'Зелёный'}, {value:'orange',label:'Оранжевый'},
    {value:'brown',label:'Коричневый'}, {value:'multicolor',label:'Комбинированный'},
  ],
  sources: [{value:'office',label:'Офис'},{value:'showcase',label:'Витрина'}],
  payments: WATCH_PAYMENTS,
} as const

/** Human labels only. Technical values (quartz/steel/black etc) are stable
 * stock/SKU identities, so never rewrite stored values just to translate UI. */
const RUSSIAN_WATCH_CHOICES:Record<string,Readonly<Record<string,string>>>={
 movements:{quartz:'КВАРЦЕВЫЕ',mechanical:'МЕХАНИЧЕСКИЕ'},
 bracelets:{steel:'СТАЛЬНОЙ',leather:'КОЖА',rubber:'КАУЧУК'},
 dials:{black:'ЧЕРНЫЙ',white:'БЕЛЫЙ',silver:'СЕРЕБРИСТЫЙ',
   gold:'ЗОЛОТИСТЫЙ',green:'ЗЕЛЕНЫЙ',orange:'ОРАНЖЕВЫЙ',
   brown:'КОРИЧНЕВЫЙ',multicolor:'КОМБИНИРОВАННЫЙ'},
}
export function watchReferenceLabel(kind:string,raw:string):string{
 const value=String(raw||'').trim()
 return (RUSSIAN_WATCH_CHOICES[kind]?.[value.toLocaleLowerCase('ru-RU')]||value)
   .toLocaleUpperCase('ru-RU')
}

export interface WatchVariantInput {
  gender: WatchGender
  movement: WatchMechanism
  braceletMaterial: WatchBraceletMaterial
  dialColor: WatchDialColor
  braceletColor?: string | null
}
export interface CanonicalWatchVariant extends Omit<WatchVariantInput,'braceletColor'> {
  braceletColor: string
}
export interface WatchOrderInput {
  brand: WatchBrand
  source: WatchSource
  recipientName: string
  recipientPhone: string
  address: string
  postalCode: string
  city: string
  deliveryMethod: string
  shippingDeadlineLocal: string
  urgent: boolean
  paymentMethod: WatchPaymentMethod
}
function fail(message: string): never { throw new Error(message) }
function enumOne<T extends string>(input: unknown, accepted: readonly T[], field: string): T {
  if (typeof input !== 'string' || !accepted.includes(input as T)) fail('Некорректное поле: '+field)
  return input as T
}
const norm = (value: unknown) => typeof value === 'string' ? value.trim().replace(/\s+/g,' ') : ''
function required(value: unknown, label: string, max = 300): string {
  const text = norm(value)
  if (!text || text.length>max) fail('Заполните '+label)
  return text
}
export function normalizeWatchVariant(input: WatchVariantInput): CanonicalWatchVariant {
  const gender=enumOne(input.gender,['male','female'],'пол')
  // Actual allowed values are checked against tenant-wide reference values in
  // registerWatchVariant. Spaces inside names are preserved (Main reference model).
  const movement=required(input.movement,'механизм',80)
  const braceletMaterial=required(input.braceletMaterial,'материал браслета',80)
  const dialColor=required(input.dialColor,'цвет циферблата',80)
  const braceletColor=norm(input.braceletColor).toLocaleUpperCase('ru-RU')
  if (braceletMaterial==='leather' && !braceletColor) fail('Для кожаного ремешка укажите цвет')
  if (braceletMaterial!=='leather' && braceletColor) fail('Цвет ремешка сейчас учитывается только для кожи')
  if (braceletColor.length>80) fail('Слишком длинный цвет ремешка')
  return {gender,movement,braceletMaterial,dialColor,braceletColor}
}
export function normalizeWatchBrand(value: unknown): WatchBrand {
  return enumOne(value,WATCH_BRANDS,'бренд')
}
export function watchSkuKey(brandInput: unknown, modelInput: unknown, input: WatchVariantInput): string {
  const brand=normalizeWatchBrand(brandInput)
  const model=required(modelInput,'модель',150).toLocaleUpperCase('ru-RU')
  const v=normalizeWatchVariant(input)
  return JSON.stringify([brand,model,v.gender,v.movement,v.braceletMaterial,v.dialColor,v.braceletColor])
}
/** Existing trusted Main stock engine maps warehouse→Office, boutique→Showcase. */
export function watchSourceToLegacy(value: WatchSource): 'warehouse'|'boutique' {
  const source=enumOne(value,['office','showcase'],'место хранения')
  return source==='office'?'warehouse':'boutique'
}
export function legacySourceToWatch(value: string): WatchSource {
  if(value==='warehouse')return 'office'
  if(value==='boutique')return 'showcase'
  return fail('Неизвестное место хранения часов')
}
/** Kazakhstan has UTC+05:00; store UTC and preserve explicit Asia/Almaty semantics. */
export function watchDeadlineToUTC(value: unknown): string {
  if (typeof value!=='string') return fail('Укажите дату и точное время отправки')
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if(!m)return fail('Укажите дату и время отправки: ГГГГ-ММ-ДД ЧЧ:ММ')
  const [y,mo,d,h,min]=m.slice(1).map(Number)
  if(y<2020||y>2100||mo<1||mo>12||d<1||d>31||h>23||min>59)fail('Некорректная дата отправки')
  const shifted=Date.UTC(y,mo-1,d,h,min)-5*3600*1000
  const local=new Date(shifted+5*3600*1000)
  if(local.getUTCFullYear()!==y||local.getUTCMonth()+1!==mo||local.getUTCDate()!==d||
     local.getUTCHours()!==h||local.getUTCMinutes()!==min)fail('Несуществующая дата отправки')
  return new Date(shifted).toISOString()
}
export function validateWatchOrderInput(input: WatchOrderInput) {
  const brand=normalizeWatchBrand(input.brand)
  const source=enumOne(input.source,['office','showcase'],'место хранения')
  const paymentMethod=required(input.paymentMethod,'способ оплаты',80)
  if (typeof input.urgent!=='boolean') fail('Срочность должна быть задана явно')
  const recipientName=required(input.recipientName,'ФИО получателя',200)
  const recipientPhone=required(input.recipientPhone,'номер телефона',50)
  const address=required(input.address,'полный адрес доставки',500)
  const postalCode=required(input.postalCode,'индекс',20)
  const city=required(input.city,'город',100)
  const deliveryMethod=required(input.deliveryMethod,'способ доставки',100)
  return {
    brand,source,legacySource:watchSourceToLegacy(source),recipientName,recipientPhone,
    address,postalCode,city,deliveryMethod,shippingDeadlineAt:watchDeadlineToUTC(input.shippingDeadlineLocal),
    deadlineTimezone:'Asia/Almaty' as const,urgent:input.urgent,paymentMethod,
  }
}
export type WatchAccess = {role:string;allowedBrands:readonly WatchBrand[]}
export function requireWatchBrandAccess(actor:WatchAccess, requested:unknown):WatchBrand {
  const brand=normalizeWatchBrand(requested)
  if(actor.role==='admin')return brand
  if(!actor.allowedBrands.includes(brand))fail('Нет доступа к бренду '+brand)
  return brand
}
