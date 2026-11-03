// Client3-only import from a READ-ONLY Main D1 SELECT exported as JSON.
// Never changes Main; quotes SQL identifiers/values and uppercases city display.
// Use with wrangler d1 execute --json --command="SELECT value ...".
import fs from 'node:fs'
import assert from 'node:assert/strict'
const [input,output]=process.argv.slice(2)
if(!input||!output)throw Error('Usage: node sync-main-watch-cities.mjs main-readonly.json output.sql')
const response=JSON.parse(fs.readFileSync(input,'utf8'))
const rows=response?.[0]?.results
assert(Array.isArray(rows)&&rows.length>0&&rows.length<5000,
  'Read-only Main city export absent, empty or unexpectedly large')
const values=[...new Set(rows.map(row=>{
 assert(typeof row?.value==='string','Expected a single city value per Main reference')
 const city=row.value.trim().replace(/\s+/g,' ').toLocaleUpperCase('ru-RU')
 assert(city.length>0&&city.length<=80&&!/[\u0000-\u001f\u007f]/.test(city),
   'Invalid Main city reference')
 return city
}))]
assert(values.length>0)
const quote=s=>"'"+s.replaceAll("'","''")+"'"
const statements=values.flatMap(city=>[
 `INSERT OR IGNORE INTO watch_city_values(kind,value,is_active) VALUES('cities',${quote(city)},1);`,
 `UPDATE watch_city_values SET is_active=1 WHERE kind='cities' AND value=${quote(city)} COLLATE NOCASE;`,
])
fs.writeFileSync(output,'-- Safe copy of ACTIVE Main city names, into Client3 ONLY.\n'+
 statements.join('\n')+'\n','utf8')
console.log('CLIENT3_MAIN_CITIES_READONLY_EXPORT_OK: '+values.length+' unique active Main names')
