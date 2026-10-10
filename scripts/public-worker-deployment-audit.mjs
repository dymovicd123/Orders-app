const account=process.env.CF_ACCOUNT_ID, token=process.env.CF_API_TOKEN
if(!account||!token){console.log('CF secret configuration missing, API metadata inspection skipped');process.exit(0)}
async function api(path){
 const url='https://api.cloudflare.com/client/v4/accounts/'+account+path
 try{
  const resp=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)})
  const data=await resp.json()
  if(!resp.ok||!data.success){console.log('API error',resp.status,
    (data.errors||[]).map(x=>({code:x.code,message:x.message})));return null}
  return data.result
 }catch(e){console.log('API request exception',e.message);return null}
}
for(const name of ['orders-app-branch2','branch2-orders-app']){
 console.log('=== SCRIPT '+name+' ===')
 const subdomain=await api('/workers/scripts/'+encodeURIComponent(name)+'/subdomain')
 console.log('WORKER SUBDOMAIN',subdomain?JSON.stringify(subdomain):'not accessible or unconfigured')
 const settings=await api('/workers/scripts/'+encodeURIComponent(name)+'/settings')
 if(settings)console.log('WORKER SETTINGS',JSON.stringify({compatibility_date:settings.compatibility_date,has_assets:!!settings.assets,bindings:(settings.bindings||[]).map(b=>({type:b.type,name:b.name}))}))
 const result=await api('/workers/scripts/'+encodeURIComponent(name)+'/deployments?per_page=8')
 if(!result){console.log('Worker may not exist or deployment read restricted.');continue}
 const deployments=Array.isArray(result)?result:result.deployments||[]
 for(const d of deployments.slice(0,8)){
   console.log(JSON.stringify({created:d.created_on,id:d.id,source:d.source,
    author:d.author_email,annotations:d.annotations,
    versions:(d.versions||[]).map(v=>({id:v.version_id,percent:v.percentage}))}))
 }
 if(deployments[0]?.versions?.[0]?.version_id){
  const version=await api('/workers/scripts/'+encodeURIComponent(name)+
  '/versions/'+deployments[0].versions[0].version_id)
  if(version)console.log('ACTIVE VERSION',JSON.stringify({id:version.id,created:version.created_on,
     metadata:version.metadata,annotations:version.annotations}))
 }
}
