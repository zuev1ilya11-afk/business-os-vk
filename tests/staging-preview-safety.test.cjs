const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createPreviewServer}=require('../scripts/preview-master-order.cjs');
test('existing master preview refuses cross-site API, exposes only root public assets and carries isolation banner',async()=>{
 const {server}=await createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const root=await fetch(base);assert.equal(root.status,200);
  assert.match(await root.text(),/ТЕСТОВАЯ СРЕДА — НЕ РАБОЧИЕ ДАННЫЕ/);
  assert.match(root.headers.get('content-security-policy'),/default-src 'none'/);
  for(const file of ['/package.json','/deploy/report-acceptance/gas-deployment-20261030.json','/docs/lemana/preview.html','/sw.js','/tests/helpers/full-stack.cjs'])assert.equal((await fetch(base+file)).status,404,file);
  assert.equal((await fetch(base+'/preview-api/mini-app-api',{method:'POST',headers:{Origin:'https://outside.invalid'},body:'{}'})).status,403);
  const wrongHost=await new Promise((resolve,reject)=>{const req=http.get(base,{headers:{Host:'outside.invalid'}},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject)});
  assert.equal(wrongHost,403);
 }finally{await new Promise(r=>server.close(r))}
});
