// Validate current Branch2 stock-attention source, then replay the previous full
// release checks against immutable original Git bytes, without weakening tests.
import fs from 'node:fs'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const baselineRef = '3c8f01124b9d0585d784275c3f410f657f8c9638'
const current = {
  'shared/api-contracts.ts': 'bd5d5af29b2e0aaec65d10a93f52890f3c2a45c9',
  'worker/domains/warehouse-attention.ts': '0f08bef67978cf0a4b0602c822564027e0260a12',
  'src/features/inventory/views/renderInventoryAttentionPanel.tsx': '2c115f77f73f2604b92b736c1989dc482559ba80',
  'src/App.tsx': 'bec55aa26cdcb38f284cdf47daa7ccceae9ea9b2',
  'src/features/inventory/useInventoryAttentionActions.ts': '5f99b1eced722ef98178e76fee8a5f7e15509da3',
  'src/features/sections/OrdersHeaderSection.tsx': 'baaab8c9bc43a924265486bba51f3c7fca920ea0',
  'src/features/sections/InventorySection.tsx': '42aa1f07c507193e79406d5b11fa7102527b4b84',
  'src/styles/192b2a-warehouse-attention-actions.css': '01393ee48907d28adab80f0a92434f2194d41a7c',
}
const historicalFiles = [...Object.keys(current), 'scripts/branch2-unified-kaspi-preserved-gate.mjs', 'scripts/catalog-integrity-branch2-preserved-gate.mjs']
const sha = bytes => crypto.createHash('sha1')
  .update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex')
const requireOk = (value, explanation) => { if (!value) throw new Error(explanation) }
const execute = (command, args, env = process.env) => {
  const run = spawnSync(command,args,{stdio:'inherit',env,shell:false,maxBuffer:16*1024*1024,timeout:25*60*1000})
  requireOk(!run.error && run.status === 0,
    'Stock-attention current/frozen release failed: ' + command + ' ' + args.join(' ') + ' (' + String(run.status) + ')')
}
const checkCurrent = () => {
  for (const [file, expected] of Object.entries(current))
    requireOk(sha(fs.readFileSync(file)) === expected, 'Current candidate source changed unexpectedly: ' + file)
}
checkCurrent()
execute(process.execPath,['scripts/test-branch2-stock-attention-context-20261021.mjs'])
const ui = fs.readFileSync('src/features/inventory/views/renderInventoryAttentionPanel.tsx','utf8')
const orders = fs.readFileSync('src/features/sections/OrdersHeaderSection.tsx','utf8')
requireOk(ui.includes('Открыть заказ') && ui.includes('Оформить приход') &&
  ui.includes('Проверить количество') && ui.includes("attentionCategory === 'shortage'"),
  'New stock-alert actions missing')
requireOk(orders.includes('Посмотреть заказы и действия') && orders.includes('stockConcerns > 0'),
  'New non-dismissible Orders warning missing')
execute(process.platform==='win32'?'npm.cmd':'npm',['run','typecheck'])

// Historical assertions are unchanged. Replay them against exact prior
// release source, not artificially updated hashes. Always restore candidate.
const preserved = new Map()
try {
  if (spawnSync('git',['cat-file','-e',baselineRef+':src/App.tsx'],{stdio:'ignore'}).status !== 0)
    execute('git',['fetch','--no-tags','--depth=1','origin',baselineRef])
  for (const file of historicalFiles) {
    const old = spawnSync('git',['show',baselineRef+':'+file],{encoding:null,maxBuffer:16*1024*1024})
    requireOk(!old.error && old.status===0, 'Exact historical source unavailable: '+file)
    preserved.set(file,fs.readFileSync(file))
    fs.writeFileSync(file,old.stdout)
  }
  execute(process.execPath,['scripts/branch2-unified-kaspi-preserved-gate.mjs'],
    {...process.env, STOCK_ATTENTION_FROZEN_REPLAY:'1'})
} finally {
  for (const [file, bytes] of preserved) fs.writeFileSync(file,bytes)
}
checkCurrent()
execute(process.execPath,['scripts/test-branch2-stock-attention-context-20261021.mjs'])
fs.rmSync('dist',{recursive:true,force:true})
execute(process.platform==='win32'?'npm.cmd':'npm',['run','build'])
requireOk(fs.existsSync('dist/client/assets'),'Restored candidate bundle was not built')
console.log('STOCK_ATTENTION_CURRENT_AND_ORIGINAL_BRANCH2_RELEASE_PASSED')
