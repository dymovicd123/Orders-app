// Current shipping policy must be validated against actual D1-compatible SQL,
// then all immutable prior branch2 regressions run on byte-exact baseline source.
// Restore current files and rebuild CURRENT runtime after the frozen replay.
import fs from 'node:fs'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
const baseline = 'aca09fdc8dda87370504f3033845d3e87392597d'
const current = {
  "worker/index.ts": "ba5fd71331815f1073410c8aae9a28c28663c5e1",
  "worker/domains/order-reservations.ts": "da314c1fe1c6c42d49f15c8e39c0344e1c368d4f",
  "worker/domains/orders-write.ts": "041fdff0a9c44219d8eadcd674a54cc3d1b42359",
  "worker/domains/warehouse-attention.ts": "bbe3b56b54625a612fdc68dd290b67552d1cd83a",
  "shared/api-contracts.ts": "cb8fb5260885d021bfa685ea1ad428e61cb8f50b",
  "src/App.tsx": "de474a96c837294c409ea134b4d5d4cac82995e5",
  "src/features/sections/OrdersHeaderSection.tsx": "7cb3c013ab4f584f48d9d67907e9a7e3a0ff05b2",
  "src/features/inventory/views/renderInventoryAttentionPanel.tsx": "f69d7aab98fec1d361940efe05190084cafe429f",
  "src/features/sections/InventorySection.tsx": "ccc00bdaac4599ea6e67206b80199fc1056192e8",
  "scripts/test-branch2-shipping-no-shortage-confirmation-20261021.mjs": "6f597acbcd2e834591cd6d4eb9c1343471609d7b"
}
const historical = {
  "worker/index.ts": "1511ecd841a31c86ab9fc352b84bd5bc0e6f9e06",
  "worker/domains/order-reservations.ts": "d8300a40e2beec2dd38b214a6e3a33fb2836a994",
  "worker/domains/orders-write.ts": "4511edc57947784301aaf411ac669f6cbc206381",
  "worker/domains/warehouse-attention.ts": "0f08bef67978cf0a4b0602c822564027e0260a12",
  "shared/api-contracts.ts": "bd5d5af29b2e0aaec65d10a93f52890f3c2a45c9",
  "src/App.tsx": "bec55aa26cdcb38f284cdf47daa7ccceae9ea9b2",
  "src/features/sections/OrdersHeaderSection.tsx": "baaab8c9bc43a924265486bba51f3c7fca920ea0",
  "src/features/inventory/views/renderInventoryAttentionPanel.tsx": "2c115f77f73f2604b92b736c1989dc482559ba80",
  "src/features/sections/InventorySection.tsx": "42aa1f07c507193e79406d5b11fa7102527b4b84"
}
const blob = bytes => crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex')
const check = (yes, message) => { if(!yes) throw new Error(message) }
const cmd = (program,args,env=process.env) => {
 const r=spawnSync(program,args,{env,stdio:'inherit',shell:false,timeout:30*60*1000,maxBuffer:16*1024*1024})
 check(!r.error && r.status===0,'Current/frozen shipping gate failed: '+program+' '+args.join(' ')+' ('+String(r.status)+')')
}
const validate = () => { for(const [path,sha] of Object.entries(current)) check(blob(fs.readFileSync(path))===sha,'Reviewed current shipping source changed: '+path) }
validate()
cmd(process.execPath,['--experimental-strip-types','scripts/test-branch2-shipping-no-shortage-confirmation-20261021.mjs'])
cmd(process.platform==='win32'?'npm.cmd':'npm',['run','typecheck'])
const original = new Map()
try {
 if(spawnSync('git',['cat-file','-e',baseline+':src/App.tsx'],{stdio:'ignore'}).status!==0)
  cmd('git',['fetch','--no-tags','--depth=1','origin',baseline])
 for(const [path,sha] of Object.entries(historical)){
  const old=spawnSync('git',['show',baseline+':'+path],{encoding:null,maxBuffer:16*1024*1024})
  check(!old.error && old.status===0 && blob(old.stdout)===sha,'Missing or changed immutable Branch2 baseline: '+path)
  original.set(path,fs.readFileSync(path))
  fs.writeFileSync(path,old.stdout)
 }
 // Original source-pinned suites remain unchanged, including Resolver, stock,
 // order, return/exchange, money and idempotent shipping.
 cmd(process.platform==='win32'?'npm.cmd':'npm',['run','release:check'],
  {...process.env,SHIPPING_SHORTAGE_FROZEN_REPLAY:'1'})
}finally{
 for(const [path,bytes] of original) fs.writeFileSync(path,bytes)
}
validate()
cmd(process.execPath,['--experimental-strip-types','scripts/test-branch2-shipping-no-shortage-confirmation-20261021.mjs'])
fs.rmSync('dist',{recursive:true,force:true})
cmd(process.platform==='win32'?'npm.cmd':'npm',['run','build'])
check(fs.existsSync('dist/client/assets'),'Current shipping UI bundle not restored/built')
console.log('BRANCH2_SHIPPING_NO_POPUP_CURRENT_AND_FROZEN_REGRESSIONS_PASSED')
