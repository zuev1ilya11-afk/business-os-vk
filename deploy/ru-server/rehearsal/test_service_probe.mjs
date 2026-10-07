import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {safeSignedURL, verifyBytes, requestLocal, runProbe} from './service_probe.mjs';

test('signed URLs stay on the exact synthetic object path',()=>{
  assert.equal(safeSignedURL('/object/sign/bos-trial-test/probe.txt?token=abc','bos-trial-test').hostname,'127.0.0.1');
  for(const url of ['https://evil.invalid/a','//evil.invalid/a','/object/sign/real-bucket/probe.txt?token=x'])
    assert.throws(()=>safeSignedURL(url,'bos-trial-test'));
});
test('wrong bytes and MIME fail even if byte count matches',()=>{
  const body=Buffer.from('abc'), row={size:3,sha256:createHash('sha256').update(body).digest('hex'),mimetype:'image/jpeg'};
  verifyBytes(body,'image/jpeg',row);
  assert.throws(()=>verifyBytes(Buffer.from('abd'),'image/jpeg',row));
  assert.throws(()=>verifyBytes(body,'text/html',row));
});
test('all requests reject redirects and arbitrary origins',async()=>{
  let options;
  await requestLocal('http://127.0.0.1:5000/status',{},async(url,opt)=>{options=opt;return new Response('{}')});
  assert.equal(options.redirect,'error');
  await assert.rejects(()=>requestLocal('http://example.invalid/',{},()=>assert.fail('unexpected network')));
});
test('anonymous exposure fails before synthetic writes',async()=>{
  const body=Buffer.from('abc');let writes=0;
  const config={service_key:'local-service',anon_key:'local-anon',expected_orders:114,expected_auth_users:1,
    bucket:'business-os-vk-files',objects:[{name:'file',size:3,sha256:createHash('sha256').update(body).digest('hex'),mimetype:'text/plain'}]};
  const fetcher=async(url,opt)=>{
    if(opt.method&&opt.method!=='GET')writes++;
    const u=new URL(url);
    if(u.port==='3000')return new Response(opt.headers.Authorization.includes('local-service')?'[{"id":1}]':'[]',
      {headers:{'content-range':'0-0/114'}});
    if(u.pathname==='/health'||u.pathname==='/status')return new Response('{}');
    if(u.pathname==='/admin/users')return opt.headers.Authorization.includes('local-service')
      ?new Response('{"users":[{"id":"dummy"}]}'):new Response('{}',{status:403});
    return new Response(body,{headers:{'content-type':'text/plain'}});
  };
  await assert.rejects(()=>runProbe(config,fetcher),/anonymous/);
  assert.equal(writes,0);
});

test('successful probe mutates only its new synthetic bucket and cleans it',async()=>{
  const sourceBody=Buffer.from('source');
  const config={service_key:'service',anon_key:'anon',expected_orders:114,expected_auth_users:1,
    bucket:'business-os-vk-files',objects:[{name:'file',size:6,sha256:createHash('sha256').update(sourceBody).digest('hex'),mimetype:'text/plain'}]};
  let bucket,probeBody,removedObject=false,removedBucket=false;
  const fetcher=async(url,options)=>{
    const u=new URL(url),path=u.pathname,method=options.method||'GET';
    const admin=options.headers?.Authorization==='Bearer service';
    if(u.port==='3000')return new Response(admin?'[{"id":1}]':'[]',{headers:{'content-range':'0-0/114'}});
    if(path==='/health'||path==='/status')return new Response('{}');
    if(path==='/admin/users')return new Response(admin?'{"users":[{"id":"one"}]}':'{}',{status:admin?200:403});
    if(path==='/bucket'&&method==='POST'){
      bucket=JSON.parse(options.body).id;assert.match(bucket,/^bos-trial-[a-f0-9]{32}$/);return new Response('{}');
    }
    if(method!=='GET'){
      assert.ok(bucket&&path.includes('/'+bucket), 'writes must stay inside synthetic bucket');
      if(method==='POST'&&path.includes('/object/sign/'))return new Response(JSON.stringify({signedURL:`/object/sign/${bucket}/probe.txt?token=test`}));
      if(method==='POST'){probeBody=Buffer.from(options.body);return new Response('{}');}
      if(path===`/object/${bucket}`){removedObject=true;return new Response('[]');}
      if(path===`/bucket/${bucket}`){removedBucket=true;return new Response('{}');}
    }
    if(path.includes('/object/sign/'))return new Response(probeBody,{headers:{'content-type':'text/plain'}});
    if(!admin)return new Response('{}',{status:403});
    return new Response(path.includes('/business-os-vk-files/')?sourceBody:probeBody,{headers:{'content-type':'text/plain'}});
  };
  const result=await runProbe(config,fetcher);
  assert.equal(result.storage_objects,1);assert.equal(result.storage_bytes,6);
  assert.equal(result.storage_signed_read,true);assert.ok(removedObject&&removedBucket);
});
