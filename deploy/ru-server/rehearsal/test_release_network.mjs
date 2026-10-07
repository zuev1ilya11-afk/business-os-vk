import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./release_network.js',import.meta.url),'utf8');
function setup(fetcher){
 const w={fetch:fetcher};w.window=w;w.location={origin:'https://139.100.237.167',href:'https://139.100.237.167/'};
 vm.runInNewContext(source,{window:w,location:w.location,URL,Request,Headers,Response});return w;
}
test('legacy gateways and Request body move to target once and preserve headers',async()=>{
 let calls=[];
 const w=setup(async(i,init)=>{const r=new Request(i,init);calls.push(r);return new Response('ok')});
 const req=new Request('https://api-v2.appdeploy.ai/app/business-os-api-gateway-3y8h7e/api/proxy/report-api?a=1',
 {method:'POST',headers:{'x-bos-session':'session'},body:'{"action":"finalizeMasterReport"}'});
 await w.fetch(req);
 assert.equal(calls.length,1);assert.equal(calls[0].url,'https://139.100.237.167/functions/v1/report-api?a=1');
 assert.equal(calls[0].headers.get('x-bos-session'),'session');assert.equal(await calls[0].text(),'{"action":"finalizeMasterReport"}');
});
test('network error never replays and unknown source path fails closed',async()=>{
 let n=0;const w=setup(async()=>{n++;throw Error('network')});
 await assert.rejects(w.fetch('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/mini-app-api',{method:'POST',body:'{}'}));
 assert.equal(n,1);
 await assert.rejects(w.fetch('https://obsropbslfwtanyspjbi.supabase.co/unknown'));
 assert.equal(n,1);
});
