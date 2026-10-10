const account=process.env.CF_ACCOUNT_ID,token=process.env.CF_API_TOKEN;
if(!account||!token)throw new Error('Missing CF read access');
const uid='eac3b621-1b02-4fe7-98d1-b53b7754e626';
const url='https://api.cloudflare.com/client/v4/accounts/'+account+'/builds/builds/'+uid+'/logs';
let cursor='';
for(let page=0;page<5;page++){
 const response=await fetch(url+(cursor?'?cursor='+encodeURIComponent(cursor):''),{
  headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(18000)
 });
 const json=await response.json();
 if(!response.ok||!json.success){console.log('BUILD LOG ERROR',response.status,
   JSON.stringify(json.errors?.map(e=>({code:e.code,message:e.message}))));break}
 const rows=(json.result?.lines||[]).map(x=>Array.isArray(x)?x.map(String).join(' '):String(x));
 const relevant=rows.filter(x=>/commit|branch|build|vite|wrangler|cache|version|deploy|upload|github|checkout|checkout|asset|root directory|npm|source|clon/i.test(x));
 console.log('BUILD LOG PAGE '+page,'total',rows.length,'filtered',relevant.length);
 for(const line of relevant.slice(-130))console.log(line.replace(/(Bearer|token|secret|password)=?[^ ]*/ig,'[REDACTED]'));
 if(!json.result?.truncated||!json.result?.cursor)break;
 cursor=json.result.cursor;
}
