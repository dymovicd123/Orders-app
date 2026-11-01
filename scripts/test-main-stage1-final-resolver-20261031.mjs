import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { inferUnambiguousCatalogReviewGender } from '../worker/domains/catalog-review.ts'
import { createResolutionSession, sameReferenceValue, rankedReferenceValues, segmentCompoundRemainder } from '../src/features/orders/catalogResolutionFlow.ts'

const sql=new DatabaseSync(':memory:')
sql.exec([
 "CREATE TABLE catalog_products(id INTEGER PRIMARY KEY, category TEXT, is_active INTEGER)",
 "CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY, product_id INTEGER, category TEXT, gender TEXT, color TEXT, material TEXT, length TEXT, size_label TEXT, is_active INTEGER)",
 "INSERT INTO catalog_products VALUES(1,'adult',1),(2,'adult',1)",
 "INSERT INTO catalog_variants VALUES(11,1,'adult','ЖЕН','КРАСНЫЙ','ДРАП КАШЕМИР','СТАНДАРТ','46',1)",
 "INSERT INTO catalog_variants VALUES(12,1,'adult','МУЖ','КРАСНЫЙ','ДРАП КАШЕМИР','СТАНДАРТ','46',1)",
 "INSERT INTO catalog_variants VALUES(21,2,'adult','МУЖ','КРАСНЫЙ','ДРАП КАШЕМИР','СТАНДАРТ','46',1)",
].join(';\n')+';')
const db={prepare(query){let vals=[];return {bind(...p){vals=p;return this},async all(){return {results:sql.prepare(query).all(...vals)}}}}}
const facts={category:'adult',material:'ДРАП КАШЕМИР',length:'СТАНДАРТ',color:'КРАСНЫЙ',size:'46'}
assert.equal(await inferUnambiguousCatalogReviewGender(db,{...facts,productId:1}),'','Ambiguous active SKU must not guess gender')
assert.equal(await inferUnambiguousCatalogReviewGender(db,{...facts,productId:2}),'МУЖ','Unique canonical SKU must prove item gender')
assert.equal(await inferUnambiguousCatalogReviewGender(db,{...facts,productId:2,color:''}),'','Empty color cannot prove exact identity')
assert.equal(await inferUnambiguousCatalogReviewGender(db,{...facts,productId:2,size:''}),'','Empty size cannot prove exact identity')
sql.exec('UPDATE catalog_variants SET is_active=0 WHERE id=21')
assert.equal(await inferUnambiguousCatalogReviewGender(db,{...facts,productId:2}),'','Retired SKU cannot be resurrected by preview')
sql.close()

assert(sameReferenceValue('ДРАП-КАШЕМИР','драп кашемир'),'Recognized punctuation equivalent must not create a new reference')
assert.equal(rankedReferenceValues(['ДРАП КАШЕМИР','АТЛАС'],'драп кашемир','material')[0].value,'ДРАП КАШЕМИР')
const compound=segmentCompoundRemainder('ДРАП КАШЕМИР КРАСНЫЙ 46',{
 references:{materials:['ДРАП КАШЕМИР'],lengths:['СТАНДАРТ'],colors:['КРАСНЫЙ'],sizes:['46'],childAges:[]}
},{category:'adult'})
assert.equal(compound.complete,true,'Exact compound characteristics must be recognized without extra questions')
assert.equal(compound.segments.length,3)

const first=createResolutionSession()
let post=0,ships=0,reads=0
await assert.rejects(()=>first.run(async()=>{post++;throw Error('HTTP response lost')},async()=>true,async()=>{ships++}),/lost/)
first.markUncertainWrite()
await first.run(null,async()=>{reads++;return true},async()=>{ships++;return true})
await first.run(null,async()=>{reads++;return true},async()=>{ships++;return true})
assert.deepEqual([post,reads,ships],[1,1,1],'One server GET replay, no second POST/shipment')
const blocked=createResolutionSession()
blocked.markUncertainWrite()
let incorrectShips=0
await blocked.run(null,async()=>false,async()=>{incorrectShips++})
assert.equal(incorrectShips,0,'Remaining resolver issue forbids automatic shipping')
const next=createResolutionSession()
let nextShips=0
await next.run(async()=>{},async()=>true,async()=>{nextShips++;return true})
assert.equal(nextShips,1,'Consecutive orders must have separate session completion latches')
console.log('MAIN_DERIVED_STAGE1_RESIDUAL_SQLITE_FLOW_PASS: gender ambiguity, unique exact SKU, retired safety, recognized reference/compound, lost response, consecutive orders')
