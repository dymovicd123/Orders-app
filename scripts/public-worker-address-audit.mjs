const hosts = [
  'https://orders-app-branch2.orders-clothes.workers.dev',
  'https://branch2-orders-app.orders-clothes.workers.dev',
  'https://nonexistent-worker-20261010-check.orders-clothes.workers.dev',
  'https://25b03713-orders-app-branch2.orders-clothes.workers.dev',
  'https://d7eddfbe-orders-app-branch2.orders-clothes.workers.dev'
];
async function read(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {'Cache-Control':'no-store, max-age=0', 'Pragma':'no-cache'},
    signal: AbortSignal.timeout(15000)
  });
  const text = await res.text();
  return {status:res.status,url:res.url,text,cacheControl:res.headers.get('cache-control'),
    cfCache:res.headers.get('cf-cache-status'),contentType:res.headers.get('content-type'),
    server:res.headers.get('server'),age:res.headers.get('age'),etag:res.headers.get('etag'),ray:res.headers.get('cf-ray')};
}
for (const base of hosts) {
  console.log('=== ORIGIN '+base+' ===');
  try {
    const index = await read(base+'/?branch2-url-audit='+Date.now());
    const file = index.text.match(/src=["'](\/assets\/index-[^"']+\.js)["']/);
    console.log(JSON.stringify({htmlStatus:index.status,canonicalUrl:index.url,
      htmlBytes:index.text.length,indexAsset:file?.[1]||null,cacheControl:index.cacheControl,
      cfCache:index.cfCache,server:index.server,age:index.age,etag:index.etag,ray:index.ray,contentType:index.contentType,
      title:(index.text.match(/<title>([^<]+)/)||[])[1]||null}));
    if (!file) continue;
    const js = await read(base+file[1]);
    const chunk = js.text.match(/ReferencesSection-[A-Za-z0-9_-]+\.js/);
    console.log(JSON.stringify({entryStatus:js.status,entryBytes:js.text.length,
      referencesChunk:chunk?.[0]||null}));
    if(!chunk)continue;
    const references = await read(base+'/assets/'+chunk[0]);
    const markers = [
      'Все рабочие справочники',
      'Проверка дублей',
      'Объединить значения',
      'Разобрать прежнее объединение товаров'
    ];
    console.log(JSON.stringify({referencesStatus:references.status,
      referencesBytes:references.text.length,
      markers:Object.fromEntries(markers.map(x=>[x,references.text.includes(x)]))}));
  } catch(err) {
    console.log('REQUEST_FAILED '+(err?.message||err));
  }
}
