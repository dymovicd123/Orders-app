import fs from 'node:fs'
import path from 'node:path'
const directory='.github/workflows'
let checked=0,suspicious=[]
for(const name of fs.readdirSync(directory).filter(x=>/\.ya?ml$/.test(x)).sort()){
 const source=fs.readFileSync(path.join(directory,name),'utf8')
 const start=source.match(/^on:\s*$/m)
 if(!start) continue
 const remaining=source.slice(start.index+start[0].length)
 const cut=remaining.search(/^(?:permissions|concurrency|env|jobs|defaults):/m)
 const events=remaining.slice(0,cut<0?Math.min(1000,remaining.length):cut)
 const push=/^  push:\s*$/m.test(events)
 const branch2=/(?:branches\s*:\s*\[[^\]]*\bbranch2\b|^\s+-\s+branch2\s*$)/m.test(events)
 const conditions=source.match(/^\s*if:.*$/gm)||[]
 const lines=source.split('\n')
 const hits=lines.map((line,i)=>({line:i+1,text:line.trim()})).filter(({text})=>
  /(?:wrangler\s+deploy|npm\s+run\s+deploy|wrangler\s+versions\s+deploy|workers\/scripts\/.*\/deployments|wrangler\s+d1\s+execute\s+.*--remote|curl.*-X\s+(?:POST|PATCH|PUT|DELETE)|npm\s+run\s+\S*deploy)/i.test(text))
 if(push&&branch2){
   suspicious.push({name,changedPaths:events.match(/paths:\s*\n(?:\s+-.*\n){0,12}/)?.[0]?.slice(0,180)||null,
    deployCommands:hits,maybeDeploy:/\bdeploy\b/i.test(source),usesCloudflareSecrets:/CLOUDFLARE_API_TOKEN|CF_API_TOKEN/.test(source),
    jobs:source.match(/^  [a-zA-Z0-9_-]+:\s*$/gm)?.map(x=>x.trim())||[],
    conditions:conditions.slice(0,4)})
 }
 checked++
}
console.log('BRANCH2_AUTOMATIC_WORKFLOW_INVENTORY '+JSON.stringify({checked,autoBranch2:suspicious.length,workflows:suspicious}))
