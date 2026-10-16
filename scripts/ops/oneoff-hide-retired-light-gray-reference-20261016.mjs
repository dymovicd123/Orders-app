// One-off exact reference retirement. In production, only reference_values.is_active
// may change; no SKU, stock, orders, finance, movement or history writes.
// PR -> live SELECT-only preflight; merged main push -> guarded UPDATE and SELECT postcheck.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';

const event=process.env.GITHUB_EVENT_NAME;
assert((event==='pull_request'&&process.env.GITHUB_BASE_REF==='main')||(event==='push'&&process.env.GITHUB_REF==='refs/heads/main'),'Only main PR or main push');
assert.equal(process.env.GITHUB_ACTIONS,'true');
const cfg=process.env.TARGET_D1_CONFIG;
assert(cfg,'Missing pinned D1 config');
const config=fs.readFileSync(cfg,'utf8');
assert(config.includes('"database_name": "orders_db_prod"')&&config.includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'),'Incorrect database');
const sourceColor='СВЕТЛО СЕРЫЙ';
const canonicalColor='СВЕТЛО-СЕРЫЙ';
function query(sql,write=false){
  assert(write? /^UPDATE\s/i.test(sql):/^SELECT\s/i.test(sql),'Forbidden SQL type');
  assert(!sql.includes(';'),'No multi statement execution');
  const raw=execFileSync('npx',['wrangler','d1','execute','orders_db_prod','--remote','--config',cfg,'--command='+sql,'--json'],
    {encoding:'utf8',timeout:90000,maxBuffer:15*1024*1024});
  const parsed=JSON.parse(raw);
  assert(parsed.length===1&&parsed[0].success===true&&Array.isArray(parsed[0].results),'D1 failed');
  return parsed[0];
}
const read=(sql)=>query(sql).results;
const refs=read("SELECT id,kind,value,is_active,updated_at FROM reference_values WHERE kind='color' AND UPPER(TRIM(value)) IN ('СВЕТЛО СЕРЫЙ','СВЕТЛО-СЕРЫЙ') ORDER BY id");
const old=refs.filter(r=>r.value===sourceColor);
const keeper=refs.filter(r=>r.value===canonicalColor);
assert.equal(old.length,1,'Expected exactly one exact old color reference');
assert.equal(keeper.length,1,'Expected exactly one exact canonical color reference');
assert.equal(keeper[0].is_active,1,'The correct СВЕТЛО-СЕРЫЙ must remain available');
assert([0,1].includes(old[0].is_active),'Unexpected old color state');
const variants=read("SELECT v.id,v.is_active,v.product_id,v.stock_position_id,v.color,COALESCE(SUM(s.quantity),0) AS physical,COALESCE(SUM(s.reserved_quantity),0) AS reserved FROM catalog_variants v LEFT JOIN inventory_stock s ON s.variant_id=v.id WHERE UPPER(TRIM(COALESCE(v.color,'')))='СВЕТЛО СЕРЫЙ' GROUP BY v.id ORDER BY v.id");
assert(variants.length>=2&&variants.some(x=>x.id===1532)&&variants.some(x=>x.id===1533),'Missing historical source variants');
assert(variants.every(v=>v.is_active===0&&v.physical===0&&v.reserved===0),'Cannot hide color still referenced by active SKU or stock/reserves');
const pair=read('SELECT id,source_variant_id,target_variant_id,source_physical_quantity,source_reserved_quantity FROM catalog_variant_consolidations WHERE source_variant_id IN (1532,1533) ORDER BY source_variant_id');
assert(pair.length===2&&pair[0].source_variant_id===1532&&pair[0].target_variant_id===1280&&pair[1].source_variant_id===1533&&pair[1].target_variant_id===1281,'Source SKU merges must be confirmed');
const pairChecks=read('SELECT consolidation_id,passed FROM catalog_variant_consolidation_validations WHERE consolidation_id IN ('+pair.map(x=>x.id).join(',')+') ORDER BY consolidation_id');
const reserveChecks=read('SELECT consolidation_id,passed FROM catalog_variant_consolidation_reservation_validations WHERE consolidation_id IN ('+pair.map(x=>x.id).join(',')+') ORDER BY consolidation_id');
assert(pairChecks.length===2&&pairChecks.every(x=>x.passed===1)&&reserveChecks.length===2&&reserveChecks.every(x=>x.passed===1),'Merge checks not fully validated');
const activeElsewhere=read("SELECT COUNT(*) AS n FROM catalog_variants WHERE is_active=1 AND UPPER(TRIM(COALESCE(color,'')))='СВЕТЛО СЕРЫЙ'")[0].n;
assert.equal(activeElsewhere,0,'Old name is active on an existing SKU');
const before=read("SELECT id,is_active FROM reference_values WHERE kind='color' AND value IN ('СВЕТЛО СЕРЫЙ','СВЕТЛО-СЕРЫЙ') ORDER BY id");
const summary={oldReferenceId:old[0].id,oldActive:old[0].is_active,canonicalId:keeper[0].id,canonicalActive:keeper[0].is_active,historicalVariants:variants.map(x=>({id:x.id,active:x.is_active,physical:x.physical,reserved:x.reserved})),consolidationIds:pair.map(x=>x.id),noActiveOldVariants:true};
console.log('LIGHT_GRAY_REFERENCE_PREFLIGHT='+JSON.stringify(summary));
if(event==='pull_request'){
 console.log('LIGHT_GRAY_REFERENCE_READ_ONLY_PREFLIGHT_SUCCESS');
 process.exit(0);
}
if(old[0].is_active===1){
  const oldId=Number(old[0].id),keeperId=Number(keeper[0].id);
  assert(Number.isSafeInteger(oldId)&&Number.isSafeInteger(keeperId)&&oldId!==keeperId);
  const stamp=new Date().toISOString();
  assert(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(stamp));
  const sql="UPDATE reference_values SET is_active=0,updated_at='"+stamp+"' "+
   "WHERE id="+oldId+" AND kind='color' AND value='СВЕТЛО СЕРЫЙ' AND is_active=1 "+
   "AND EXISTS(SELECT 1 FROM reference_values WHERE id="+keeperId+" AND kind='color' AND value='СВЕТЛО-СЕРЫЙ' AND is_active=1) "+
   "AND NOT EXISTS(SELECT 1 FROM catalog_variants v WHERE UPPER(TRIM(COALESCE(v.color,'')))='СВЕТЛО СЕРЫЙ' "+
   "AND (v.is_active=1 OR EXISTS(SELECT 1 FROM inventory_stock s WHERE s.variant_id=v.id AND (s.quantity<>0 OR s.reserved_quantity<>0)))) "+
   "AND EXISTS(SELECT 1 FROM catalog_variant_consolidations c JOIN catalog_variants v ON v.id=c.source_variant_id "+
   "JOIN catalog_variants k ON k.id=c.target_variant_id "+
   "WHERE c.source_variant_id=1532 AND c.target_variant_id=1280 AND v.is_active=0 AND k.is_active=1) "+
   "AND EXISTS(SELECT 1 FROM catalog_variant_consolidations c JOIN catalog_variants v ON v.id=c.source_variant_id "+
   "JOIN catalog_variants k ON k.id=c.target_variant_id "+
   "WHERE c.source_variant_id=1533 AND c.target_variant_id=1281 AND v.is_active=0 AND k.is_active=1)";
  const result=query(sql,true);
  assert.equal(Number(result.meta?.changes),1,'CAS fail: reference was NOT disabled');
} else {
  console.log('LIGHT_GRAY_REFERENCE_ALREADY_HIDDEN_NO_WRITES');
}
const after=read("SELECT id,kind,value,is_active FROM reference_values WHERE kind='color' AND value IN ('СВЕТЛО СЕРЫЙ','СВЕТЛО-СЕРЫЙ') ORDER BY id");
assert.equal(after.length,2,'Reference row deleted unexpectedly');
assert(after.some(x=>x.id===old[0].id&&x.is_active===0&&x.value===sourceColor),'Old color not hidden');
assert(after.some(x=>x.id===keeper[0].id&&x.is_active===1&&x.value===canonicalColor),'Canonical color changed');
const picker=read("SELECT COUNT(*) AS n FROM reference_values WHERE kind='color' AND is_active=1 AND value='СВЕТЛО СЕРЫЙ'")[0];
assert.equal(picker.n,0,'Old color still appears as active option');
const historicalAfter=read("SELECT id,color,is_active FROM catalog_variants WHERE id IN (1280,1281,1532,1533) ORDER BY id");
assert.deepEqual(historicalAfter.map(x=>x.is_active),[1,1,0,0],'SKU state changed');
assert(historicalAfter.find(x=>x.id===1532).color===sourceColor&&historicalAfter.find(x=>x.id===1533).color===sourceColor,'Historical color snapshot changed');
const stockStatus=read("SELECT SUM(quantity) AS physical,SUM(reserved_quantity) AS reserved FROM inventory_stock WHERE variant_id IN (1280,1281,1532,1533)")[0];
assert.equal(stockStatus.physical,0);
assert.equal(stockStatus.reserved,0);
const orphans=read("SELECT COUNT(*) AS n FROM inventory_stock s LEFT JOIN catalog_variants v ON v.id=s.variant_id WHERE s.variant_id IS NOT NULL AND v.id IS NULL")[0].n;
assert.equal(orphans,0);
console.log('LIGHT_GRAY_REFERENCE_HIDDEN_PRODUCTION_SUCCESS='+JSON.stringify({referenceId:old[0].id,isActive:0,keeperId:keeper[0].id,keeperActive:1,activePickerMatches:0,originalArchiveVariantsStillPresent:true,physical:0,reserved:0,orphans:0}));
